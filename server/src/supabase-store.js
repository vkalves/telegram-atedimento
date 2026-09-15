import {openAsBlob} from 'node:fs';
import fs from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';
export class SupabaseStore {
 constructor({url,key,bucket='ta-media',fetchImpl=fetch}){
  const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new Error('SUPABASE_URL precisa ser HTTPS.');
  this.url=parsed.origin;this.key=key;this.bucket=bucket;this.fetch=fetchImpl;
  if(!key)throw new Error('Configure SUPABASE_SERVICE_ROLE_KEY no Render.');
 }
 async request(route,{method='GET',headers={},body,raw=false}={}){
  const auth={apikey:this.key};
  // JWT service_role uses Bearer; the newer sb_secret key is sent only as apikey.
  if(!this.key.startsWith('sb_secret_'))auth.Authorization='Bearer '+this.key;
  let response;
  try{response=await this.fetch(this.url+route,{method,headers:{...auth,...headers},body,signal:AbortSignal.timeout(90000)});}catch{throw new Error('Supabase não respondeu. Confira o projeto e a conexão.');}
  if(!response.ok)throw new Error(`Supabase retornou ${response.status}. Confira o SQL, a chave secreta, o projeto ativo e a cota de armazenamento.`);
  if(raw)return response;
  return response.status===204?null:await response.json();
 }
 async getState(id){const rows=await this.request('/rest/v1/ta_state?select=payload&id=eq.'+encodeURIComponent(id));return rows.length?rows[0].payload:null;}
 async setState(id,payload){await this.request('/rest/v1/ta_state',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({id,payload}),raw:true});}
 objectPath(name){if(!/^[a-f0-9-]+\.(ogg|mp4|jpg|jpeg|png)$/.test(name))throw new Error('Nome de arquivo inválido.');return '/storage/v1/object/'+encodeURIComponent(this.bucket)+'/'+encodeURIComponent(name);}
 async upload(name,file,mime){if((await fs.stat(file)).size>50*1024*1024)throw new Error('O arquivo convertido excedeu 50 MB. Use um arquivo menor.');await this.request(this.objectPath(name),{method:'POST',headers:{'Content-Type':mime,'x-upsert':'false'},body:await openAsBlob(file,{type:mime}),raw:true});}
 async download(name,file){const response=await this.request(this.objectPath(name).replace('/object/','/object/authenticated/'),{raw:true});await pipeline(Readable.fromWeb(response.body),createWriteStream(file,{flags:'w',mode:0o600}));}
 async remove(name){await this.request('/storage/v1/object/'+encodeURIComponent(this.bucket),{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[name]}),raw:true});}
}
