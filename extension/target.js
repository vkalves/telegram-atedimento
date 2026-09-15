export function peerFromURL(href){
 try{
  const url=new URL(href);if(url.origin!=='https://web.telegram.org'||!/^\/(a|k)\/?$/.test(url.pathname))return null;
  const hash=decodeURIComponent(url.hash.slice(1));
  return /^(?:[1-9]\d{0,19}|@[A-Za-z0-9_]{5,32})$/.test(hash)?hash:null;
 }catch{return null;}
}
// Separate the context generation from network latency so old results cannot win.
export class TargetTracker{
 constructor(){this.key=null;this.target=null;this.generation=0;}
 change(key){this.key=key;this.target=null;return ++this.generation;}
 accept(generation,target){if(generation!==this.generation)return false;this.target=target;return true;}
}
