import React from 'react';
import {AbsoluteFill,Audio,Freeze,OffthreadVideo,staticFile,useCurrentFrame} from 'remotion';
import timing from './investor-v4-copyedit-timing.json';
import {ExactDynamicPlatformV4,ExactConnectedCycleV4} from './ExactClosingV4';
import {Fonts,Heading,Label,ExactBrand,nativeCues} from './InvestorExactFilm';
import {ProductMovementPreview} from './ProductPoseV2';
import {ExactSetupV3} from './ExactSetupV3';
import {ExactPlatformV3} from './ExactPlatformV3';
import {ExactBroadJumpV2} from './ExactBroadJumpV2';
import {ExactChangeOfDirectionV3} from './ExactChangeOfDirectionV3';
import {ExactTechniqueV4} from './ExactTechniqueV4';
import {ExactPlayerProfileV3,ExactPlanBuilderV3,ExactGuidedWorkoutV3,ExactProgressReviewV3} from './ExactScreensV3';

export const V4_COPYEDIT_DURATION=timing.duration_frames;
const C={bg:'#04130e',panel:'#0a211a',lime:'#b7f34a',ink:'#f0f5ed',muted:'#a9bdb1',line:'#254036'};
const mono='"IBM Plex Mono",monospace';
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
export const smoothV3=(f:number,a:number,b:number)=>{const u=clamp((f-a)/(b-a));return u*u*(3-2*u);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
type Cue={start:number;end:number;text:string};
type Props={audioEnabled?:boolean;captions?:Cue[]};
type Box={x:number;y:number;w:number;h:number};
const FULL:Box={x:96,y:235,w:1728,h:700};
const DEMO:Box={x:96,y:319,w:1175,h:560};
const PROP:Box={x:370,y:522,w:400,h:198};
const OPEN:Box={x:96,y:396,w:610,h:298.25};
const boxMix=(a:Box,b:Box,t:number):Box=>({x:mix(a.x,b.x,t),y:mix(a.y,b.y,t),w:mix(a.w,b.w,t),h:mix(a.h,b.h,t)});
const TESTS=['Sprint','Vertical jump','Broad jump','Dribbling','Change of direction','Shooting'];
const tile=(i:number):Box=>({x:96+(i%3)*(1728+22)/3,y:243+Math.floor(i/3)*337,w:(1728-44)/3,h:315});

function Phone({box,sourceFrame,result=0,resultFrame=0}:{box:Box;sourceFrame:number;result?:number;resultFrame?:number}){
 const pad=box.w<610?mix(10,13,clamp((box.w-400)/210)):mix(13,16,clamp((box.w-1175)/553)),innerW=box.w-pad*2-4,innerH=box.h-pad*2-4,scale=Math.min(innerW/1728,innerH/700);
 return <div style={{position:'absolute',left:box.x,top:box.y,width:box.w,height:box.h,boxSizing:'border-box',padding:pad,border:'2px solid #829a8a',borderRadius:24,background:'#010a06',overflow:'hidden'}}>
  <div style={{position:'absolute',inset:pad+2,opacity:1-result}}><Freeze frame={Math.min(749,Math.max(0,sourceFrame))}><OffthreadVideo src={staticFile('product/screen-demo.mp4')} muted style={{width:'100%',height:'100%',objectFit:'contain',borderRadius:12}}/></Freeze></div>
  {result>0&&<div style={{position:'absolute',left:pad+2+(innerW-1728*scale)/2,top:pad+2+(innerH-700*scale)/2,opacity:result,transform:`scale(${scale})`,transformOrigin:'0 0'}}><ExactBroadJumpV2 frame={resultFrame}/></div>}
 </div>;
}
function HeadSwap({a,b,t}:{a:[string,string];b:[string,string];t:number}){
 return <><div style={{position:'absolute',inset:0,opacity:1-smoothV3(t,0,.5),transform:`translateY(${-8*t}px)`}}><Heading label={a[0]} title={a[1]}/></div><div style={{position:'absolute',inset:0,opacity:smoothV3(t,.5,1),transform:`translateY(${8*(1-t)}px)`}}><Heading label={b[0]} title={b[1]}/></div></>;
}
const SETUP_HEAD:[string,string]=['02 / CAPTURE WORKFLOW','Smartphone, custom marker and athlete'];
const DEMO_HEAD:[string,string]=['03 / ORIGINAL APP DEMONSTRATION','Broad jump — guided capture'];
const RESULT_HEAD:[string,string]=['03 / ORIGINAL APP DEMONSTRATION','Broad jump · Recorded result'];
const ANALYSIS_HEAD:[string,string]=['03 / MOVEMENT CAPTURE','On-device movement analysis'];
const TEST_HEAD:[string,string]=['03 / MOVEMENT CAPTURE','Six tests'];
const COD_HEAD:[string,string]=['04 / PERFORMANCE COMPARISON','Change of direction · Example player and D1 reference'];

function OpeningSetup({frame:f}:{frame:number}){
 if(f<351)return <ExactPlatformV3 frame={f} opening/>;
 if(f<375){const t=smoothV3(f,351,375);return <>
  <div style={{position:'absolute',inset:0,opacity:1-smoothV3(t,0,.6),clipPath:'inset(235px 0 0 0)'}}><ExactPlatformV3 frame={f} opening hidePhone/></div>
  <div style={{position:'absolute',inset:0,opacity:smoothV3(t,.4,1)}}><ExactSetupV3 frame={0} hidePhone/></div>
  <HeadSwap a={['01 / POSETEK','Smartphone capture. Movement analysis. Connected platform.']} b={SETUP_HEAD} t={t}/>
  <Phone box={boxMix(OPEN,PROP,t)} sourceFrame={165}/>
 </>;}
 const local=f-375,t=smoothV3(local,246,270);
 return <><div style={{opacity:1-t}}><ExactSetupV3 frame={local} hidePhone={local>=246}/></div>
  <HeadSwap a={SETUP_HEAD} b={DEMO_HEAD} t={t}/>
  {local>=246&&<><div style={{opacity:t}}><Field frame={0}/></div><Phone box={boxMix(PROP,DEMO,t)} sourceFrame={0}/></>}
 </>;
}
function Field({frame}:{frame:number}){
 const shot=frame>=300,t=smoothV3(frame,546,570);
 return <div style={{position:'absolute',left:1378+55*t,top:245,width:365,opacity:1-t,transform:`scale(${1-.04*t})`,transformOrigin:'right center'}}>
  <Label style={{fontSize:18,color:C.lime,marginBottom:16}}>{shot?'JUMP EXCERPT · 1×':'FIELD RECORDING · SETUP'}</Label>
  <div style={{position:'relative',width:365,height:649,borderRadius:18,overflow:'hidden',border:`1px solid ${C.line}`,background:C.bg}}>
   <Freeze frame={shot?frame-300:frame}><OffthreadVideo src={staticFile(shot?'investor-exact/field-jump.mp4':'investor-exact/field-readiness.mp4')} muted style={{width:365,height:649,objectFit:'contain'}}/></Freeze>
   {frame>=300&&frame<309&&<div style={{position:'absolute',inset:0,background:C.bg,clipPath:`inset(0 ${smoothV3(frame,300,309)*100}% 0 0)`}}/>}
  </div>
 </div>;
}

/** One mounted phone from capture through processing/result and the test tile.
 * All geometry comes from the manifest; recorded joints are never interpolated.
 */
function CaptureToTests({frame:f}:{frame:number}){
 const d=f-645,m=timing.motion;
 const center=smoothV3(f,m.phone_reflow[0],m.phone_reflow[1]);
 const result=smoothV3(f,m.result_reveal[0],m.result_reveal[1]);
 const toTile=smoothV3(f,m.result_to_tests[0],m.result_to_tests[1]);
 const containers=smoothV3(f,m.test_containers[0],m.test_containers[1]);
 const expand=smoothV3(f,m.cod_expand[0],m.cod_expand[1]);
 const resultFrame=Math.max(0,f-m.result_reveal[0]);
 const phoneBox=boxMix(boxMix(DEMO,FULL,center),tile(2),toTile);
 let a=DEMO_HEAD,b=RESULT_HEAD,t=result;
 if(f>=1380){a=RESULT_HEAD;b=ANALYSIS_HEAD;t=smoothV3(f,1380,1395);}
 if(f>=m.result_to_tests[0]){a=ANALYSIS_HEAD;b=TEST_HEAD;t=toTile;}
 if(f>=m.cod_expand[0]){a=TEST_HEAD;b=COD_HEAD;t=expand;}
 return <><HeadSwap a={a} b={b} t={t}/>
  {f<1215&&<Field frame={d}/>}
  {f<m.result_to_tests[1]&&<div style={{position:'absolute',inset:0,zIndex:2,opacity:1-smoothV3(toTile,.65,1)}}><Phone box={phoneBox} sourceFrame={d} result={result} resultFrame={resultFrame}/></div>}
  <Label style={{position:'absolute',left:96,top:929,fontSize:18,opacity:(1-center)*smoothV3(d,0,15)}}>Original app audio · Complete jump at 1×</Label>
  {f>=m.result_to_tests[0]&&TESTS.map((name,i)=>{const r=tile(i);return <div key={name} style={{position:'absolute',left:r.x,top:r.y,width:r.w,height:r.h,overflow:'hidden',borderRadius:14,background:`rgba(10,33,26,${containers})`,opacity:(i===2?smoothV3(toTile,.55,1):toTile)*(1-expand),transform:`translateY(${(1-toTile)*(i===2?0:25)}px)`}}>
   <div style={{position:'absolute',left:48,top:-7}}><ProductMovementPreview index={i} f={Math.max(0,f-m.result_to_tests[1])}/></div>
   <svg width="100%" height="100%" viewBox="0 0 561 315" style={{position:'absolute',inset:0}}><rect x="1" y="1" width="559" height="313" rx="13" fill="none" stroke={C.line} strokeWidth="2" pathLength="1" strokeDasharray="1" strokeDashoffset={1-containers}/></svg>
   <div style={{position:'absolute',left:25,bottom:18,fontSize:28,fontWeight:600}}><span style={{fontFamily:mono,fontSize:17,color:C.lime,marginRight:20}}>0{i+1}</span>{name}</div>
  </div>;})}
  {f>=m.cod_expand[0]&&<div style={{position:'absolute',left:mix(tile(4).x,FULL.x,expand),top:mix(tile(4).y,FULL.y,expand),width:mix(tile(4).w,FULL.w,expand),height:mix(tile(4).h,FULL.h,expand),background:C.panel,borderRadius:mix(14,22,expand),border:`1px solid ${C.line}`,overflow:'hidden',zIndex:3}}>
   <div style={{position:'absolute',inset:0,opacity:1-smoothV3(expand,0,.5)}}><div style={{position:'absolute',left:48,top:-7}}><ProductMovementPreview index={4} f={f-m.result_to_tests[1]}/></div><div style={{position:'absolute',left:25,bottom:18,fontSize:28,fontWeight:600}}><span style={{color:C.lime,fontFamily:mono,fontSize:17,marginRight:20}}>05</span>Change of direction</div></div>
   <div style={{opacity:smoothV3(expand,.5,1),transform:`scale(${mix(tile(4).w/FULL.w,1,expand)})`,transformOrigin:'0 0'}}><ExactChangeOfDirectionV3 frame={0}/></div>
  </div>}
 </>;
}
type Scene={id:string;start:number;end:number};
const HEADS:Record<string,[string,string]>={
 'change-of-direction':COD_HEAD,
 profile:['05 / PROFILE AND PLANNING','The skill map and its supporting results'],
 planning:['05 / PROFILE AND PLANNING','Selected focus → personalized training plan'],
 training:['06 / GUIDED TRAINING','Guided workout session'],
 technique:['07 / TECHNIQUE OBSERVATION','AI Kick Analysis'],
 retest:['08 / RETESTING','Reassessment and the next training focus'],
 'closing-passage':['09 / CONNECTED PLATFORM','Testing, training and coaching assistance'],
 platform:['09 / CONNECTED PLATFORM','Testing, training and coaching assistance'],
 'two-kick-review':['RECORDED TWO-KICK REVIEW','Two kicks from the same example player'],
};
function Body({id,frame}:{id:string;frame:number}){
 switch(id){
  case 'change-of-direction':return <ExactChangeOfDirectionV3 frame={frame}/>;
  case 'profile':return <ExactPlayerProfileV3 frame={frame}/>;
  case 'planning':return <ExactPlanBuilderV3 frame={frame}/>;
  case 'training':return <ExactGuidedWorkoutV3 frame={frame}/>;
  case 'technique':return <ExactTechniqueV4 frame={frame}/>;
  case 'retest':return <ExactProgressReviewV3 frame={frame*1.8}/>;
  default:return null;
 }
}
function Workspace({scene,frame}:{scene:Scene;frame:number}){
 if(scene.id==='closing-passage')return <ExactDynamicPlatformV4 frame={frame}/>;
 if(scene.id==='connected-cycle')return <ExactConnectedCycleV4 frame={frame}/>;
 if(scene.id==='identity')return null;
 return <><Heading label={HEADS[scene.id][0]} title={HEADS[scene.id][1]}/><div style={{position:'absolute',left:96,top:235,width:1728,height:700}}><Body id={scene.id} frame={frame}/></div></>;
}
/** Shared viewport remains opaque; incoming views arrive before the boundary,
 * so the technique quarter-speed menu starts on a fully settled screen.
 */
function LateScenes({frame:f}:{frame:number}){
 const scenes=timing.scenes.filter(s=>s.start>=1614);
 const index=scenes.findIndex(s=>f>=s.start&&f<s.end),s=scenes[index];if(!s)return null;
 const local=f-s.start,next=scenes[index+1],start=s.end-18;
 if(s.id==='identity')return <ExactConnectedCycleV4 frame={timing.cycle.duration_frames+local}/>;
 if(s.id==='connected-cycle')return <ExactConnectedCycleV4 frame={local}/>;
 // The platform/cycle uses its own continuous phone and workspace handoff.
 if(s.id==='closing-passage')return <ExactDynamicPlatformV4 frame={local}/>;
 if(next&&f>=start&&next.id!=='identity'){
  const t=smoothV3(f,start,s.end),panels=next.id!=='closing-passage';
  if(panels)return <><HeadSwap a={HEADS[s.id]} b={HEADS[next.id]} t={t}/>
   <div style={{position:'absolute',...{left:96,top:235,width:1728,height:700},overflow:'hidden',borderRadius:22,background:C.panel}}>
    <div style={{position:'absolute',inset:0,opacity:1-smoothV3(t,0,.5),transform:`translateX(${-60*t}px)`}}><Body id={s.id} frame={local}/></div>
    <div style={{position:'absolute',inset:0,opacity:smoothV3(t,.5,1),transform:`translateX(${60*(1-t)}px)`}}><Body id={next.id} frame={0}/></div>
   </div></>;
  return <><HeadSwap a={HEADS[s.id]} b={HEADS[next.id]} t={t}/><div style={{position:'absolute',inset:0,opacity:1-smoothV3(t,0,.6),clipPath:'inset(235px 0 0 0)',transform:`translateY(${-12*t}px)`}}><Workspace scene={s} frame={local}/></div><div style={{position:'absolute',inset:0,opacity:smoothV3(t,.4,1),clipPath:'inset(235px 0 0 0)',transform:`translateY(${12*(1-t)}px)`}}><Workspace scene={next} frame={0}/></div></>;
 }
 return <Workspace scene={s} frame={local}/>;
}
export const InvestorV4CopyEdit:React.FC<Props>=({audioEnabled=false,captions=[]})=>{
 const f=useCurrentFrame(),caption=captions.find(c=>f/30>=c.start&&f/30<c.end),demo=f>=645&&f<1395;
 const native=demo?nativeCues.find(c=>(f-645)/30>=c.start&&(f-645)/30<c.end):null;
 const brand=smoothV3(f,3351,3375),fade=1-smoothV3(f,3465,3480);
 return <AbsoluteFill style={{background:C.bg,color:C.ink,fontFamily:'Inter,sans-serif',overflow:'hidden'}}><Fonts/>
  {f<645?<OpeningSetup frame={f}/>:f<1614?<CaptureToTests frame={f}/>:<LateScenes frame={f}/>}
  <div style={{position:'absolute',left:mix(96,625,brand),top:mix(51,475,brand),transform:`scale(${mix(1,2.8,brand)})`,transformOrigin:'0 0',opacity:fade}}><ExactBrand/></div>
  <Label style={{position:'absolute',right:96,top:65,fontSize:16,letterSpacing:1,opacity:1-brand}}>INVESTOR PRESENTATION</Label>
  {f>=3351&&<div style={{position:'absolute',top:625,width:'100%',textAlign:'center',fontFamily:mono,fontSize:34,color:C.muted,letterSpacing:1,opacity:smoothV3(f,3366,3378)*fade}}>Learn more at <span style={{color:C.lime}}>posetek.net</span></div>}
  {(native||caption&&!demo)&&<div style={{position:'absolute',left:120,right:120,top:962,minHeight:66,display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',fontSize:29,lineHeight:1.3,whiteSpace:'pre-line',padding:'7px 22px',boxSizing:'border-box',background:'#04130ef8',borderRadius:10}}>{native?.text??caption?.text}</div>}
  {audioEnabled&&<Audio src={staticFile('audio-investor-v4-copyedit/master.wav')}/>}
 </AbsoluteFill>;
};
