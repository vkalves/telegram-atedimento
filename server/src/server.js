import 'dotenv/config';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {TelegramService} from './telegram.js';
import {VoiceLibrary} from './library.js';
import {Sequences} from './sequences.js';
import {CategoryStore} from './categories.js';
import {createApp} from './app.js';
import {FlowStore,FlowWorker} from './flows.js';
import {SupportStore,SupportInbox} from './support.js';
import {SupabaseStore} from './supabase-store.js';
const dataDir=path.resolve(process.env.DATA_DIR||'./data'),port=Number(process.env.PORT||8080);
const apiId=process.env.TELEGRAM_API_ID,apiHash=process.env.TELEGRAM_API_HASH,token=process.env.ACCESS_TOKEN,extensionPassword=(process.env.EXTENSION_PASSWORD||'').trim(),encryptionKey=process.env.SESSION_ENCRYPTION_KEY;
// Render-generated secrets use a random string. Derive a 256-bit AES key deterministically.
const encryptionHex=encryptionKey ? createHash('sha256').update(encryptionKey).digest('hex') : '';
if(!/^\d+$/.test(apiId||'')||!/^[a-f\d]{32}$/i.test(apiHash||'')||!token||token.length<32||(!encryptionKey||encryptionKey.length<32)){
 console.error('Configure TELEGRAM_API_ID, TELEGRAM_API_HASH, ACCESS_TOKEN e SESSION_ENCRYPTION_KEY no servidor.');process.exit(1);
}
if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY){console.error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Render.');process.exit(1);}
const store=new SupabaseStore({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY});
const telegram=new TelegramService({apiId,apiHash,dataDir,encryptionKey:encryptionHex,store}),library=new VoiceLibrary(dataDir,store),sequences=new Sequences(dataDir,store),categories=new CategoryStore(dataDir,store,library);
try{
 await library.init();await sequences.init();await categories.init();await telegram.init();
 let flows=null,flowWorker=null;
 try{flows=new FlowStore(store);await flows.init();flowWorker=new FlowWorker({flows,telegram,library});flowWorker.start();}
 catch{flows=null;console.error("Fluxos desabilitados: aplique as migrações FLUXOS-PARTE-1.sql e FLUXOS-PARTE-2.sql, nesta ordem, e reinicie. Atendimento existente preservado.");}
 let support=null,inbox=null;
 try{support=new SupportStore(store);await support.init();inbox=new SupportInbox({support,telegram});inbox.start();}
 catch{support=null;inbox=null;console.error('Central de atendimento desabilitada: aplique ATENDIMENTO.sql e reinicie.');}
 const app=createApp({support,inbox,flows,telegram,library,sequences,categories,token,extensionPassword,extensionIds:(process.env.EXTENSION_IDS||'').split(',').map(s=>s.trim()).filter(Boolean),dashboardOrigins:(process.env.DASHBOARD_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean)});
 const server=app.listen(port,'0.0.0.0',()=>console.log(`Telegram Atendimento 4.0 online na porta ${port}`));
 server.on('error',e=>{console.error(e.message);process.exit(1);});
 process.on('SIGTERM',()=>{flowWorker?.stop();inbox?.stop();server.close(()=>process.exit(0));});
}catch(e){console.error(telegram.friendlyError(e));process.exit(1);}
