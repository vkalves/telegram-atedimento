import crypto from 'node:crypto';
export function encodeSession(session,key){
 const secret=Buffer.from(key||'','hex');if(secret.length!==32)throw new Error('SESSION_ENCRYPTION_KEY precisa ter 64 caracteres hexadecimais.');
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',secret,iv);
 const body=Buffer.concat([cipher.update(session,'utf8'),cipher.final()]);
 return JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),body:body.toString('base64')});
}
export function decodeSession(text,key){
 const data=JSON.parse(text),secret=Buffer.from(key||'','hex');if(data.v!==1||secret.length!==32)throw new Error('Formato de sessão inválido.');
 const decipher=crypto.createDecipheriv('aes-256-gcm',secret,Buffer.from(data.iv,'base64'));decipher.setAuthTag(Buffer.from(data.tag,'base64'));
 return Buffer.concat([decipher.update(Buffer.from(data.body,'base64')),decipher.final()]).toString('utf8');
}
