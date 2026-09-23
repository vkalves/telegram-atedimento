/**
 * Centralized Telegram presence/activity before a real send.
 * Typing/recording is never an idempotency boundary — only a confirmed
 * Telegram message id counts as sent.
 */
export const DEFAULT_ACTIVITY_CONFIG = Object.freeze({
  enabled: true,
  mode: 'auto',
  textEnabled: true,
  audioEnabled: true,
  textMinMs: 1000,
  textMaxMs: 4000,
  textCharsPerSecond: 16,
  textThinkingMs: 350,
  audioMinMs: 2000,
  audioMaxMs: 8000,
  audioFactor: 0.35,
  customTextMs: 2000,
  customAudioMs: 4000,
  renewEveryMs: 4000,
  jitter: 0.12
});

export class ActivityAbortedError extends Error {
  constructor(reason = 'cancelled') {
    super('Atividade interrompida antes do envio.');
    this.name = 'ActivityAbortedError';
    this.reason = reason;
  }
}

function envFlag(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  if (value === '0' || value === 'false' || value === 'off') return false;
  if (value === '1' || value === 'true' || value === 'on') return true;
  return fallback;
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function loadActivityConfig(overrides = {}) {
  const mode = String(process.env.ACTIVITY_MODE || overrides.mode || DEFAULT_ACTIVITY_CONFIG.mode).toLowerCase();
  const deterministic = envFlag('ACTIVITY_DETERMINISTIC', overrides.deterministic === true);
  return {
    ...DEFAULT_ACTIVITY_CONFIG,
    ...overrides,
    mode: ['auto', 'custom', 'off'].includes(mode) ? mode : 'auto',
    enabled: overrides.enabled ?? envFlag('ACTIVITY_ENABLED', DEFAULT_ACTIVITY_CONFIG.enabled),
    textEnabled: overrides.textEnabled ?? envFlag('ACTIVITY_TEXT', DEFAULT_ACTIVITY_CONFIG.textEnabled),
    audioEnabled: overrides.audioEnabled ?? envFlag('ACTIVITY_AUDIO', DEFAULT_ACTIVITY_CONFIG.audioEnabled),
    customTextMs: overrides.customTextMs ?? envNumber('ACTIVITY_TEXT_MS', DEFAULT_ACTIVITY_CONFIG.customTextMs),
    customAudioMs: overrides.customAudioMs ?? envNumber('ACTIVITY_AUDIO_MS', DEFAULT_ACTIVITY_CONFIG.customAudioMs),
    jitter: deterministic ? 0 : (overrides.jitter ?? DEFAULT_ACTIVITY_CONFIG.jitter),
    deterministic
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applyJitter(ms, jitter, random) {
  if (!jitter) return Math.round(ms);
  const sample = typeof random === 'function' ? random() : 0.5;
  return Math.round(ms * (1 + (sample - 0.5) * 2 * jitter));
}

export function isVoiceItem(item) {
  return item && (item.kind === 'voice' || !item.kind) && item.kind !== 'text' && item.kind !== 'video';
}

export function resolveActivityPlan(item, options = {}) {
  const config = loadActivityConfig(options.config || {});
  const kind = item?.kind === 'text' ? 'text' : isVoiceItem(item) ? 'audio' : null;
  const empty = {kind, action: kind === 'text' ? 'typing' : kind === 'audio' ? 'record' : null, delayMs: 0, renewEveryMs: config.renewEveryMs, config};
  if (!kind || !config.enabled || config.mode === 'off') return empty;
  if (kind === 'text' && !config.textEnabled) return empty;
  if (kind === 'audio' && !config.audioEnabled) return empty;

  const explicitAudio = kind === 'audio' && Number.isFinite(Number(options.recordingDelay)) && Number(options.recordingDelay) > 0;
  let delayMs = 0;
  if (explicitAudio) {
    delayMs = Math.min(15000, Math.max(0, Number(options.recordingDelay) * 1000 || 0));
  } else if (Number.isFinite(Number(options.activityDelay)) && options.activityDelay !== undefined) {
    delayMs = Math.max(0, Number(options.activityDelay) || 0);
  } else if (options.activity === false || options.activity === 'off') {
    return empty;
  } else if (options.activity === 'auto' || options.activity === true || options.activity === 'custom') {
    const mode = options.activity === 'custom' ? 'custom' : config.mode === 'custom' ? 'custom' : 'auto';
    delayMs = mode === 'custom'
      ? (kind === 'text' ? config.customTextMs : config.customAudioMs)
      : (kind === 'text' ? computeTextDelay(item?.text || '', config, options.random) : computeAudioDelay(item?.duration, config, options.random));
  }
  return {...empty, delayMs: Math.round(delayMs), renewEveryMs: config.renewEveryMs};
}

export function computeTextDelay(text, config = DEFAULT_ACTIVITY_CONFIG, random) {
  const value = String(text || '');
  const chars = value.length;
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const fromChars = (chars / Math.max(8, config.textCharsPerSecond || 16)) * 1000;
  const fromWords = words * 220;
  const raw = (config.textThinkingMs || 0) + Math.max(fromChars, fromWords);
  return clamp(applyJitter(raw, config.jitter, random), config.textMinMs, config.textMaxMs);
}

export function computeAudioDelay(durationSec, config = DEFAULT_ACTIVITY_CONFIG, random) {
  const duration = Math.max(0, Number(durationSec) || 0);
  const considered = Math.min(duration, 24);
  const raw = config.audioMinMs + considered * 1000 * (config.audioFactor || 0.35);
  return clamp(applyJitter(raw, config.jitter, random), config.audioMinMs, config.audioMaxMs);
}

export async function runTelegramActivity({
  sendAction,
  cancelAction,
  delayMs,
  renewEveryMs = 4000,
  signal,
  shouldContinue
} = {}) {
  const total = Math.max(0, Number(delayMs) || 0);
  if (!total) return;
  const timers = new Set();
  const abortError = () => new ActivityAbortedError(signal?.reason || 'cancelled');
  const throwIfStopped = async () => {
    if (signal?.aborted) throw abortError();
    if (shouldContinue && await shouldContinue() === false) throw new ActivityAbortedError('state');
  };
  const wait = ms => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => { timers.delete(timer); signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    timers.add(timer);
    const onAbort = () => { clearTimeout(timer); timers.delete(timer); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, {once: true});
  });
  const safeAction = async fn => {
    if (typeof fn !== 'function') return;
    try { await fn(); } catch { /* presence is best-effort and must never become the send boundary */ }
  };
  try {
    await throwIfStopped();
    await safeAction(sendAction);
    const started = Date.now();
    while (Date.now() - started < total) {
      await throwIfStopped();
      const remaining = total - (Date.now() - started);
      const slice = Math.min(remaining, Math.max(1, Number(renewEveryMs) || 4000));
      await wait(slice);
      if (Date.now() - started < total) {
        await throwIfStopped();
        await safeAction(sendAction);
      }
    }
  } catch (error) {
    await safeAction(cancelAction);
    throw error;
  } finally {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }
}
