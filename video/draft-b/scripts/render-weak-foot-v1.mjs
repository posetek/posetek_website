import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import {mkdir,readFile,copyFile,cp,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const mode=process.argv[2]??'stills';
if(!['stills','proof','boundary','boundaries'].includes(mode))throw Error('Use stills, proof, boundary or boundaries. Final master follows creative approval.');
const timing=JSON.parse(await readFile('src/weak-foot-v1-timing.json','utf8'));
const out=resolve('output/weak-foot-v1');await mkdir(out,{recursive:true});
const publicDir=resolve(out,'render-assets');await mkdir(publicDir,{recursive:true});
await cp(resolve('public/fonts'),resolve(publicDir,'fonts'),{recursive:true,dereference:true});
for(const file of ['poses.json','player1-right.mp4','player1-left.mp4','player2-right.mp4','player2-left.mp4']){await mkdir(resolve(publicDir,'weak-foot-v1'),{recursive:true});await copyFile(resolve('public/weak-foot-v1',file),resolve(publicDir,'weak-foot-v1',file));}
const captionFile='public/audio-weak-foot-v1/captions.json';
const captions=existsSync(captionFile)?JSON.parse(await readFile(captionFile,'utf8')):[];
if(mode==='proof'&&!captions.length)throw Error('Narration and captions must be verified before proof.');
const inputProps={audioEnabled:false,captions};
const serveUrl=await bundle({entryPoint:resolve('src/index.ts'),publicDir});
const browserExecutable=process.env.REMOTION_BROWSER_EXECUTABLE;
const composition=await selectComposition({serveUrl,id:'PoseTekWeakFootInvestorV1',inputProps,browserExecutable});
if(mode==='stills'){
 const frames=process.argv[3]?process.argv[3].split(',').map(Number):[65,174,310,430,494,603,716,840,958,1045,1140,1275,1420,1480,1545,1600,1660,1750];
 const scale=Number(process.env.WEAK_FOOT_STILL_SCALE??2/3);
 for(const frame of frames){await renderStill({serveUrl,composition,inputProps,frame,output:resolve(out,`frame-${frame}${scale===1?'-1080':''}.png`),scale,browserExecutable});console.log('Still '+frame);}
}else if(mode==='boundary'||mode==='boundaries'){
 const boundaries=mode==='boundary'?[Number(process.argv[3])]:process.argv[3]?process.argv[3].split(',').map(Number):[120,255,390,462,564,660,795,930,1002,1170,1470,1519,1568,1617,1710];
 for(const boundary of boundaries){
  if(!Number.isInteger(boundary)||boundary<16||boundary>1780)throw Error('Provide boundary frame16..1780');
  await renderMedia({serveUrl,composition,inputProps,browserExecutable,codec:'h264',outputLocation:resolve(out,`boundary-${boundary}-1080.mp4`),scale:1,frameRange:[boundary-16,boundary+19],crf:18,x264Preset:'fast',pixelFormat:'yuv420p',concurrency:3});
  console.log('1080p boundary '+boundary);
 }
}else{
 const picture=resolve(out,'PoseTek-Weak-Foot-Investor-V1-proof-picture.mp4');let last=-1;
 await renderMedia({serveUrl,composition,inputProps,browserExecutable,codec:'h264',outputLocation:picture,scale:2/3,crf:19,x264Preset:'fast',pixelFormat:'yuv420p',concurrency:4,onProgress:({progress})=>{const n=Math.floor(progress*20)*5;if(n!==last){console.log('Proof '+n+'%');last=n;}}});
 const target=resolve(out,'PoseTek-Weak-Foot-Investor-V1-Timed-Proof.mp4');
 const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',picture,'-i','public/audio-weak-foot-v1/master.wav','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t',String(timing.duration),'-movflags','+faststart',target],{encoding:'utf8',maxBuffer:8e6});
 if(r.error||r.status!==0)throw Error(r.error?.message??r.stderr);
 await copyFile('public/audio-weak-foot-v1/captions.srt',resolve(out,'PoseTek-Weak-Foot-Investor-V1.srt'));
 await writeFile(resolve(out,'proof-mux.json'),JSON.stringify({duration:60,frames:1800,fps:30,width:720,height:1280,method:'Silent picture with one AAC encode from mixed PCM',continuousMusic:true},null,2)+'\n');
 console.log(target);
}
