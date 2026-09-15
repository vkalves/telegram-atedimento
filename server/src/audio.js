import {spawn} from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
function parseDuration(stderr){const m=stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);return m?Math.max(1,Math.round(Number(m[1])*3600+Number(m[2])*60+Number(m[3]))):null;}
async function transcode(inputPath,outputPath,video){
  const executable=process.env.FFMPEG_PATH||ffmpegPath;if(!executable)throw new Error('FFmpeg não foi encontrado. Execute INSTALAR.bat.');
  const args=['-y','-hide_banner','-threads','1','-i',inputPath,'-map_metadata','-1','-threads','1',...(video?['-c:v','libx264','-preset','fast','-crf','23','-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart']:['-vn','-ac','1','-ar','48000','-c:a','libopus','-b:a','48k','-vbr','on','-application','voip','-f','ogg']),outputPath];
  return await new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:true});let stderr='';
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-200000);});
    child.on('error',()=>reject(new Error('Não foi possível abrir o FFmpeg. Execute INSTALAR.bat.')));
    child.on('close',code=>{if(code!==0)return reject(new Error('Não foi possível converter este arquivo. Verifique se ele abre no seu computador.'));
      const sizes=[...stderr.matchAll(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/g)],size=sizes.at(-1);
      resolve({duration:parseDuration(stderr),...(video&&size?{width:Number(size[1]),height:Number(size[2])}:{})});});
  });
}
export const convertToTelegramVoice=(input,output)=>transcode(input,output,false);
export const convertToTelegramVideo=(input,output)=>transcode(input,output,true);
