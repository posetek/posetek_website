import {bundle} from '@remotion/bundler';
import {selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import {mkdir,readFile,copyFile,cp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const timing=JSON.parse(await readFile('src/investor-v4-copyedit-timing.json','utf8'));
const mode=process.argv[2]??'stills';
if(!['stills','proof','master'].includes(mode))throw Error('Use stills, proof or master.');
const out=resolve('output/investor-v4-copyedit');await mkdir(out,{recursive:true});
const publicDir=resolve(out,'render-assets');await mkdir(publicDir,{recursive:true});
await cp(resolve('public/fonts'),resolve(publicDir,'fonts'),{recursive:true,dereference:true});
// Sanitized render allowlist excludes private audit records, movies and IDs.
const files=['figure-8.mp4','wall-pass.mp4','investor-exact-v2/preview-poses.json','product/screen-demo.mp4','investor-exact-v2/broadjump.json','investor-exact/profile.json','investor-exact/field-readiness.mp4','investor-exact/field-jump.mp4','investor-exact/technique.json','investor-exact-v3/cod.json'];
for(const file of files){const dest=resolve(publicDir,file);await mkdir(resolve(dest,'..'),{recursive:true});await copyFile(resolve('public',file),dest);}
const captions=JSON.parse(await readFile('public/audio-investor-v4-copyedit/captions.json','utf8'));
const inputProps={audioEnabled:false,captions};
const serveUrl=await bundle({entryPoint:resolve('src/index.ts'),publicDir});
const browserExecutable=process.env.REMOTION_BROWSER_EXECUTABLE;
const composition=await selectComposition({serveUrl,id:'PoseTekInvestorV4CopyEdit',inputProps,browserExecutable});
if(mode==='stills'){
 const frames=process.argv[3]?process.argv[3].split(',').map(Number):[2382,2390,2440,2520,2640,2760,2810,2826,2970,2985,3018,3045,3105,3135,3164,3165,3174,3183,3200,3225,3264,3320,3351,3363,3378];
 const scale=Number(process.env.COPYEDIT_STILL_SCALE??2/3);
 for(const frame of frames){await renderStill({serveUrl,composition,inputProps,frame,output:resolve(out,`frame-${frame}${scale===1?'-1080':''}.png`),scale,browserExecutable});console.log('Still '+frame);}
}else{
 let last=-1;const picture=resolve(out,'PoseTek-Investor-V4-Copyedit-'+mode+'-picture.mp4');
 await renderMedia({serveUrl,composition,inputProps,browserExecutable,codec:'h264',outputLocation:picture,scale:mode==='master'?1:2/3,crf:mode==='master'?18:20,x264Preset:'fast',pixelFormat:'yuv420p',concurrency:4,
  onProgress:({progress})=>{const n=Math.floor(progress*20)*5;if(n!==last){console.log('Proof '+n+'%');last=n;}}});
 const target=resolve(out,mode==='master'?'PoseTek-Investor-V4-Copyedit-1080p.mp4':'PoseTek-Investor-V4-Copyedit-Timed-Proof.mp4');
 const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',picture,'-i','public/audio-investor-v4-copyedit/master.wav','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t',String(timing.duration),'-movflags','+faststart',target],{encoding:'utf8',maxBuffer:8e6});
 if(r.error||r.status!==0)throw Error(r.error?.message??r.stderr);
 await writeFile(resolve(out,mode+'-mux.json'),JSON.stringify({duration:timing.duration,fps:30,width:mode==='master'?1920:1280,height:mode==='master'?1080:720,nativeStartSample:timing.music.native_start_sample,method:'Silent picture + one AAC encode of fully mixed original PCM stems',musicContinuous:true},null,2)+'\n');
 console.log(target);
}
