import fs from "node:fs/promises";
import path from "node:path";
import {encodeSession,decodeSession} from "./session-store.js";
import { TelegramClient, Api } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";

class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export class TelegramService {
  constructor({ apiId, apiHash, dataDir, encryptionKey, store = null }) {
    this.apiId = Number(apiId);
    this.apiHash = apiHash;
    this.dataDir = dataDir;
    this.encryptionKey = encryptionKey;
    this.store = store;
    this.sessionPersisted = false;
    this.sessionPath = path.join(dataDir, "session.enc");
    this.client = null;
    this.state = "idle";
    this.lastError = "";
    this.pending = null;
    this.authPromise = null;
    this.authRetryAt = 0;
    this.dialogMap = new Map();
    this.dialogMapUpdatedAt = 0;
    this.dialogRefreshPromise = null;
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    let saved = "";
    try {
      const encrypted=this.store ? await this.store.getState("telegram-session") : await fs.readFile(this.sessionPath,"utf8");
      if(encrypted) saved = decodeSession(encrypted,this.encryptionKey);
    } catch (err) { if (err.code !== "ENOENT") throw new Error("Não foi possível abrir a sessão. Verifique a chave de criptografia do servidor."); }

    this.sessionPersisted = !!saved;
    this.client = new TelegramClient(
      new StringSession(saved),
      this.apiId,
      this.apiHash,
      {
        connectionRetries: 5,
        floodSleepThreshold: 10
      }
    );

    await this.client.connect();
    if (await this.client.checkAuthorization()) {
      this.state = "authorized";
    }
  }

  async status() {
    if (!this.client) return { authorized: false, state: "idle" };

    let authorized = false;
    try {
      authorized = await this.client.checkAuthorization();
    } catch {}

    if (!authorized) {
      if (this.state === "authorized") this.state = "idle";
      return {
        authorized: false,
        state: this.state,
        lastError: this.lastError || null
      };
    }

    if(this.store && !this.sessionPersisted){
      await this.store.setState("telegram-session",encodeSession(this.client.session.save(),this.encryptionKey));
      this.sessionPersisted=true;
    }
    this.state = "authorized";
    const me = await this.client.getMe();
    const first = me?.firstName || "";
    const last = me?.lastName || "";
    return {
      authorized: true,
      state: "authorized",
      me: {
        name: `${first} ${last}`.trim() || "Conta Telegram",
        username: me?.username || null,
        id: me?.id?.toString?.() || null
      }
    };
  }

  async waitFor(kind) {
    this.pending = new Deferred();
    this.state = kind;
    return await this.pending.promise;
  }

  async startLogin(phone) {
    if (!this.client) throw new Error("Cliente Telegram ainda não foi inicializado.");
    if (await this.client.checkAuthorization()) {
      this.state = "authorized";
      return;
    }
    if (this.authPromise) return;
    if (this.authRetryAt > Date.now()) {
      const seconds = Math.ceil((this.authRetryAt - Date.now()) / 1000);
      throw new Error(`FLOOD_WAIT_${seconds}`);
    }

    this.lastError = "";
    this.state = "starting";

    this.authPromise = this.client.start({
      phoneNumber: async () => phone,
      phoneCode: async () => await this.waitFor("need_code"),
      password: async () => await this.waitFor("need_password"),
      onError: (err) => {
        this.lastError = this.friendlyError(err);
        if (this.authErrorShouldStop(err)) {
          const seconds = this.floodWaitSeconds(err);
          if (seconds) {
            this.authRetryAt = Math.max(this.authRetryAt, Date.now() + seconds * 1000);
          }
          // teleproto retries authentication while onError returns false.
          // Flood waits and terminal account/configuration errors must end
          // this attempt; retrying them can extend the block or loop forever.
          return true;
        }
        return false;
      }
    })
      .then(async () => {
        const saved = this.client.session.save();
        if(this.store) await this.store.setState("telegram-session",encodeSession(saved,this.encryptionKey));
        else {
          await fs.writeFile(this.sessionPath, encodeSession(saved,this.encryptionKey), { encoding: "utf8", mode: 0o600 });
          await fs.chmod(this.sessionPath, 0o600).catch(() => {});
        }
        this.sessionPersisted = true;
        this.authRetryAt = 0;
        this.pending = null;
        this.state = "authorized";
        this.lastError = "";
      })
      .catch(err => {
        this.pending = null;
        this.state = "error";
        // teleproto rejects with AUTH_USER_CANCEL after onError asks it to
        // stop. Keep the useful Telegram error captured by the callback.
        if (!this.lastError) this.lastError = this.friendlyError(err);
      })
      .finally(() => {
        this.authPromise = null;
      });
  }

  submitCode(code) {
    if (this.state !== "need_code" || !this.pending) {
      throw new Error("O Telegram não está aguardando um código neste momento.");
    }
    const current = this.pending;
    this.pending = null;
    this.state = "starting";
    current.resolve(code);
  }

  submitPassword(password) {
    if (this.state !== "need_password" || !this.pending) {
      throw new Error("O Telegram não está aguardando a senha 2FA neste momento.");
    }
    const current = this.pending;
    this.pending = null;
    this.state = "starting";
    current.resolve(password);
  }

  friendlyError(err) {
    const raw = String(err?.errorMessage || err?.message || err || "Erro desconhecido");
    const known = {
      PHONE_CODE_INVALID: "O código informado está incorreto.",
      PHONE_CODE_EXPIRED: "O código expirou. Solicite um novo.",
      PASSWORD_HASH_INVALID: "A senha de verificação em duas etapas está incorreta.",
      PHONE_NUMBER_INVALID: "O número de telefone informado é inválido.",
      PHONE_NUMBER_BANNED: "Este número está bloqueado pelo Telegram.",
      API_ID_INVALID: "O API ID ou API Hash está incorreto.",
    };
    for (const [key, value] of Object.entries(known)) {
      if (raw.includes(key)) return value;
    }
    const seconds = this.floodWaitSeconds(err);
    if (seconds) {
      const minutes = Math.ceil(seconds / 60);
      const wait = seconds < 60
        ? `${seconds} segundo${seconds === 1 ? "" : "s"}`
        : `${minutes} minuto${minutes === 1 ? "" : "s"}`;
      return `O Telegram limitou novas tentativas. Aguarde ${wait} antes de tentar novamente.`;
    }
    return raw.slice(0, 220);
  }

  floodWaitSeconds(err) {
    const raw = String(err?.errorMessage || err?.message || err || "");
    const match = raw.match(/FLOOD(?:_PREMIUM)?_WAIT_(\d+)/i);
    const seconds = Number(err?.seconds || match?.[1] || 0);
    return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  }

  authErrorShouldStop(err) {
    if (this.floodWaitSeconds(err)) return true;
    const raw = String(err?.errorMessage || err?.message || err || '').toUpperCase();
    return [
      'API_ID_INVALID',
      'API_HASH_INVALID',
      'PHONE_NUMBER_INVALID',
      'PHONE_NUMBER_BANNED',
      'PHONE_CODE_EXPIRED',
      'AUTH_KEY_UNREGISTERED',
      'SESSION_REVOKED',
      'USER_DEACTIVATED_BAN'
    ].some(code => raw.includes(code));
  }

  async requireAuthorized() {
    if (!this.client || !(await this.client.checkAuthorization())) {
      throw new Error("Conecte sua conta do Telegram primeiro.");
    }
  }

  async getDialogs(limit = 60) {
    await this.requireAuthorized();
    const dialogs = await this.client.getDialogs({ limit });
    this.dialogMap.clear();

    const rows = await Promise.all(dialogs.map(async dialog => {
      const entity = dialog.entity;
      const id = String(await this.client.getPeerId(entity));
      this.dialogMap.set(id, entity);

      const first = entity?.firstName || "";
      const last = entity?.lastName || "";
      const name =
        dialog.name ||
        entity?.title ||
        `${first} ${last}`.trim() ||
        entity?.username ||
        "Conversa";

      return {
        id,
        name,
        username: entity?.username || null,
        rawId: entity?.id?.toString?.() || null,
        type: entity?.className || "Peer"
      };
    }));
    this.dialogMapUpdatedAt = Date.now();
    return rows;
  }

  async refreshDialogsForTarget() {
    const fresh = this.dialogMap.size && Date.now() - this.dialogMapUpdatedAt < 30000;
    if (fresh) return;
    if (!this.dialogRefreshPromise) {
      this.dialogRefreshPromise = this.getDialogs(100).finally(() => {
        this.dialogRefreshPromise = null;
      });
    }
    await this.dialogRefreshPromise;
  }

  findDialogByUsername(username) {
    const expected = String(username || '').replace(/^@/, '').toLowerCase();
    if (!expected) return null;
    for (const entity of this.dialogMap.values()) {
      if (String(entity?.username || '').replace(/^@/, '').toLowerCase() === expected) return entity;
    }
    return null;
  }

  async currentTarget(peerKey) {
    await this.requireAuthorized();
    const key = String(peerKey || '').trim();
    if (!/^(?:[1-9]\d{0,19}|@[A-Za-z0-9_]{5,32})$/.test(key)) throw new Error("Abra uma conversa privada no Telegram Web.");

    let entity;
    if (key.startsWith('@')) {
      // Use the direct username lookup first. Loading the full dialog list can
      // be slow on a sleeping Render instance, which used to leave the
      // extension stuck on “Identificando…”. The dialog list is only a
      // fallback for accounts where the username lookup is not enough.
      entity = this.findDialogByUsername(key);
      if (!entity) {
        try {
          entity = await this.resolveTarget({username:key});
        } catch (lookupError) {
          try {
            await this.refreshDialogsForTarget();
            entity = this.findDialogByUsername(key);
          } catch {}
          if (!entity) throw lookupError;
        }
      }
    } else {
      entity = await this.resolveTarget({dialogId:key});
    }

    const className = entity?.className || entity?.constructor?.name;
    if (!entity || className !== 'User') throw new Error("Esta versão atende conversas privadas. Abra uma conversa com uma pessoa.");
    const id = String(await this.client.getPeerId(entity));
    this.dialogMap.set(id,entity);
    return {id,name: [entity.firstName,entity.lastName].filter(Boolean).join(' ') || entity.username || 'Conversa',username:entity.username || null};
  }

  async resolveTarget({ dialogId, username }) {
    await this.requireAuthorized();

    if (username) {
      const clean = String(username).trim().replace(/^@/, "");
      if (!clean) throw new Error("Informe um @usuário válido.");
      return await this.client.getEntity(clean);
    }

    if (!dialogId) throw new Error("Escolha uma conversa.");

    if (this.dialogMap.has(String(dialogId))) {
      return this.dialogMap.get(String(dialogId));
    }

    // A single failed refresh must not prevent the direct entity lookup.
    // This matters after a Render wake-up or when Telegram omits a dialog.
    try { await this.getDialogs(100); } catch {}
    if (this.dialogMap.has(String(dialogId))) {
      return this.dialogMap.get(String(dialogId));
    }

    try {
      return await this.client.getEntity(BigInt(dialogId));
    } catch {
      throw new Error("Não consegui localizar essa conversa. Atualize a lista e tente novamente.");
    }
  }

  // Durable waiting uses Telegram history, not browser events or untrusted webhooks.
  async flowReplyBaseline(dialogId) {
    const entity=await this.resolveTarget({dialogId});
    if(entity?.className!=='User')throw new Error('A espera aceita somente conversas privadas.');
    const me=await this.client.getMe();
    const messages=await this.client.getMessages(entity,{limit:1});
    return {accountId:String(me.id),cursor:Number(messages[0]?.id||0)};
  }

  async flowReplyPage(run) {
    const entity=await this.resolveTarget({dialogId:run.dialog_id});
    if(entity?.className!=='User')throw new Error('Conversa privada não localizada.');
    const me=await this.client.getMe();
    if(String(me.id)!==run.reply_account_id)throw new Error('A conta Telegram mudou. Reconecte a conta original para continuar.');
    const checkedAt=new Date().toISOString();
    // Ascending pagination prevents losing a reply behind a large offline backlog.
    const rows=await this.client.getMessages(entity,{limit:100,minId:Number(run.reply_cursor||0),reverse:true});
    let cursor=Number(run.reply_cursor||0);const messages=[];
    for(const message of rows){
      if(!Number.isSafeInteger(message.id)||message.id<=0)continue;
      const dialog=message.peerId?.userId?.toString(),sender=message.fromId?.userId?.toString()||message.senderId?.toString();
      if(dialog!==run.dialog_id)throw new Error('O Telegram retornou histórico de outra conversa. Consulta interrompida.');
      cursor=Math.max(cursor,message.id);
      if(message.className!=='Message'||message.out||dialog!==run.dialog_id||sender!==run.dialog_id||!Number.isFinite(message.date))continue;
      messages.push({id:message.id,date:message.date,dialogId:dialog,senderId:sender});
    }
    return {accountId:String(me.id),messages,cursor,complete:rows.length<100,checkedAt};
  }

  async sendItem(item, target, {recordingDelay = 0} = {}) {
    const entity = await this.resolveTarget(target);
    let result;
    if (item.kind === "text") {
      result = await this.client.sendMessage(entity, { message: item.text, parseMode: false });
    } else {
      const voice = !item.kind || item.kind === "voice";
      const options = { file: item.path, workers: 1, parseMode: false };
      if (voice) {
        options.voiceNote = true;
        options.attributes = [new Api.DocumentAttributeAudio({
          voice: true, duration: Math.max(1, Math.round(item.duration || 1))
        })];
        const delayMs = Math.min(15000, Math.max(0, Number(recordingDelay) * 1000 || 0));
        if (delayMs) {
          await this.client.invoke(new Api.messages.SetTyping({
            peer: entity,
            action: new Api.SendMessageRecordAudioAction()
          }));
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
      if (item.kind === 'video') {
        options.supportsStreaming = true;
        options.attributes = [new Api.DocumentAttributeVideo({duration: item.duration || 1, w:item.width || 2, h:item.height || 2, supportsStreaming:true})];
      }
      result = await this.client.sendFile(entity, options);
    }
    if (!result?.id) throw new Error("O Telegram não confirmou o envio. Confira a conversa antes de tentar novamente.");
    return { messageId: String(result.id) };
  }
}
