import React from 'react';
import {AbsoluteFill,Audio,Freeze,OffthreadVideo,staticFile,useCurrentFrame} from 'remotion';
import {Fonts,ExactBrand} from './InvestorExactFilm';
import timing from './weak-foot-v1-timing.json';
import {WK as C,KickRecord,KickSource,PosePair,useKicks} from './WeakFootPoseV1';

export const WEAK_FOOT_V1_DURATION=timing.duration_frames;
type Cue={start:number;end:number;text:string};
type Props={audioEnabled?:boolean;captions?:Cue[]};
const mono='"IBM Plex Mono",monospace',head='"Barlow Condensed",sans-serif';
const W=888,H=1050;
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const ease=(f:number,a:number,b:number)=>{const t=clamp((f-a)/(b-a));return t*t*(3-2*t);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const getPair=(data:KickSource,p:number)=>['right','left'].map(foot=>{const r=data.records.find(r=>r.key===`player${p}-${foot}`);if(!r)throw Error('Missing authorized recorded kick');return r;});
const Tag:React.FC<{children:React.ReactNode;color?:string;style?:React.CSSProperties}>=({children,color=C.muted,style={}})=><div style={{fontFamily:mono,fontSize:23,letterSpacing:.6,color,...style}}>{children}</div>;
function TopBar({children,detail}:{children:React.ReactNode;detail?:string}){return <div style={{position:'absolute',left:0,top:0,width:W,height:86,padding:'0 30px',boxSizing:'border-box',display:'flex',alignItems:'center',gap:15,borderBottom:`1px solid ${C.line}`,fontSize:29,fontWeight:600}}><span style={{width:9,height:9,background:C.lime,borderRadius:'50%'}}/>{children}{detail&&<Tag style={{marginLeft:'auto',fontSize:21}}>{detail}</Tag>}</div>;}
function Tap({f,at,x,y}:{f:number;at:number;x:number;y:number}){const age=f-at;if(age< -9||age>10)return null;const t=ease(age,-9,0);return <svg width={W} height={H} style={{position:'absolute',inset:0,pointerEvents:'none',zIndex:10}}>{age>=0&&<circle cx={x} cy={y} r={10+age*2.5} stroke={C.ink} fill="none" strokeWidth="2" opacity={1-age/11}/>}<path d="M0 0v29l8-8 6 13 6-3-6-12h12z" transform={`translate(${x+35*(1-t)},${y-28*(1-t)})`} fill={C.ink} stroke={C.bg} strokeWidth="2"/></svg>;}
function FootTabs({left=false,complete=false}:{left?:boolean;complete?:boolean}){return <div style={{display:'flex',gap:18,position:'absolute',left:32,right:32,top:844}}>{['Right foot','Left foot'].map((label,i)=>{const selected=left?i===1:i===0;return <div key={label} style={{flex:1,border:`1px solid ${selected?C.lime:C.line}`,background:selected?'#173322':'#071a13',borderRadius:14,padding:'22px 23px',fontSize:29,display:'flex',alignItems:'center',gap:14}}><span style={{color:(i===0&&(left||complete))?C.mint:selected?C.lime:C.muted,fontSize:27}}>{i===0&&(left||complete)?'✓':selected?'●':'○'}</span>{label}</div>;})}</div>;}
function Recorded({record,frame}:{record:KickRecord;frame:number}){
 const sourceFrame=Math.min(Math.ceil(record.video.durationSeconds*30)-1,Math.max(0,frame));
 return <Freeze frame={sourceFrame}><OffthreadVideo src={staticFile(record.video.src)} muted style={{display:'block',width:'100%',height:'100%',objectFit:'contain'}}/></Freeze>;
}
function Capture({data,player,frame,opening=false}:{data:KickSource;player:number;frame:number;opening?:boolean}){
 const pair=getPair(data,player),left=!opening&&frame>=135,local=opening?0:left?frame-135:frame,r=pair[left?1:0];
 const atEnd=local>=Math.ceil(r.video.durationSeconds*30),toLeft=!opening&&frame>=127&&frame<135,t=toLeft?ease(frame,127,135):0,labelLeft=left||(toLeft&&frame>=131),labelOpacity=toLeft?(frame<131?1-ease(frame,127,131):ease(frame,131,135)):1;
 return <><TopBar detail={opening?'CAPTURE':'1× · ORIGINAL'}>{opening?'PoseTek capture':`Example player ${player}`}</TopBar>
  <div style={{position:'absolute',left:32,right:32,top:117,display:'flex',justifyContent:'space-between',alignItems:'center'}}><div style={{fontFamily:head,fontSize:63,fontWeight:700,color:labelLeft?C.lime:C.mint,opacity:labelOpacity}}>{opening?'One player. Two feet.':labelLeft?'Left foot':'Right foot'}</div><Tag>Side view</Tag></div>
  <div style={{position:'absolute',left:0,top:232,width:W,height:W*9/16,background:'#020a06',overflow:'hidden'}}>
   <div style={{position:'absolute',inset:0,opacity:1-ease(t,0,.5)}}><Recorded record={r} frame={local}/></div>
   {toLeft&&<div style={{position:'absolute',inset:0,opacity:ease(t,.5,1)}}><Recorded record={pair[1]} frame={0}/></div>}
   {opening&&<div style={{position:'absolute',inset:0,boxShadow:'inset 0 0 70px #04130e55'}}/>}
  </div>
  <div style={{position:'absolute',left:32,right:32,top:757,display:'flex',alignItems:'center',gap:20}}><div style={{fontSize:27,color:C.lime}}>{opening?'▶':atEnd?'✓':'Ⅱ'}</div><div style={{height:4,flex:1,background:C.line}}><div style={{height:4,background:left?C.lime:C.mint,width:`${opening?0:clamp(local/(r.video.durationSeconds*30))*100}%`}}/></div><Tag style={{fontSize:21}}>{opening?'READY':atEnd?'COMPLETE':'RECORDED'}</Tag></div>
  <div style={{opacity:labelOpacity}}><FootTabs left={labelLeft}/></div><Tag style={{position:'absolute',left:32,top:970,fontSize:23}}>Same player · one recording per foot</Tag>
  {!opening&&<Tap f={frame} at={2} x={48} y={777}/>}
 </>;
}
export function weakFootComparisonState(frame:number,player:number){
 const t=timing.comparison,play=frame<t.play_frames,phaseFade=ease(frame,t.play_frames,t.play_frames+t.phase_transition_frames),paused=frame>=t.play_frames+t.phase_transition_frames;
 return {play,paused,phaseFade,seconds:t.source_start_seconds+Math.min(frame,t.play_frames-1)/30*t.speed,metric:player===1&&frame>=t.play_frames+t.phase_transition_frames+t.first_metric_frames?'thighTilt' as const:'supportKnee' as const};
}
function Comparison({data,player,frame}:{data:KickSource;player:number;frame:number}){
 const pair=getPair(data,player),state=weakFootComparisonState(frame,player),metricAt=timing.comparison.play_frames+timing.comparison.phase_transition_frames+timing.comparison.first_metric_frames,metricFade=player===1&&frame>=metricAt-8&&frame<metricAt+8?frame<metricAt?1-ease(frame,metricAt-8,metricAt):ease(frame,metricAt,metricAt+8):1;
 const evidence=player===2?ease(frame,185,205):0;
 return <><TopBar detail="RECORDED POSES">Example player {player}</TopBar>
  <div style={{position:'absolute',left:32,right:32,top:118,display:'flex'}}>{pair.map((r,i)=><div key={r.key} style={{width:'50%',fontSize:34,fontWeight:600,color:i?C.lime:C.mint}}>{r.foot==='right'?'Right foot':'Left foot'}</div>)}</div>
  <Tag color={C.ink} style={{position:'absolute',left:32,top:174,fontSize:23}}>{state.play?'¼× · Aligned at saved contact':state.paused?'PAUSED · Each recorded backswing':'SELECTING BACKSWING'}</Tag>
  <div style={{position:'absolute',left:32,top:229,width:824,height:470}}>
   <div style={{position:'absolute',inset:0,opacity:state.paused?0:1-ease(state.phaseFade,0,.48)}}><PosePair pair={pair} seconds={state.seconds}/></div>
   <div style={{position:'absolute',inset:0,opacity:state.paused?1:ease(state.phaseFade,.52,1)}}><PosePair pair={pair} seconds={0} paused metric={state.metric}/></div>
  </div>
  <div style={{position:'absolute',left:32,right:32,top:706,height:162,borderTop:`1px solid ${C.line}`,paddingTop:18,opacity:state.paused?metricFade:0}}>
   <Tag color={C.ink} style={{fontSize:26}}>{state.metric==='supportKnee'?'Support-knee angle':'Kicking-thigh tilt'} · backswing</Tag>
   <div style={{display:'flex',marginTop:8}}>{pair.map((r,i)=><div key={r.key} style={{width:'50%',fontFamily:head,fontSize:79,lineHeight:1.04,color:i?C.lime:C.mint}}>{r.metrics[state.metric].toFixed(1)}°</div>)}</div>
  </div>
  <Tag style={{position:'absolute',left:32,top:881,fontSize:22}}>Left pose mirrored for comparison</Tag>
  <div style={{position:'absolute',left:32,right:32,top:930,height:74,display:'flex',alignItems:'center',gap:16}}><div style={{padding:'17px 20px',border:`1px solid ${C.line}`,borderRadius:10,fontSize:25,color:C.ink,background:'#153128'}}>¼×</div><div style={{flex:1,padding:'18px 20px',fontSize:25,borderRadius:10,background:state.play?'#153128':C.lime,color:state.play?C.ink:C.bg,fontWeight:600,textAlign:'center'}}>{state.play?'Review backswing':state.paused?'Backswing selected':'Selecting phase…'}</div></div>
  {evidence>0&&<div style={{position:'absolute',left:32,right:32,top:930,height:74,borderRadius:10,boxSizing:'border-box',background:'#173322',border:`1px solid ${C.lime}`,padding:'20px',opacity:evidence,fontSize:25,color:C.lime}}>Own recordings → individual starting point</div>}
  <Tap f={frame} at={72} x={592} y={968}/>
 </>;
}
const savedCue='With your left foot, try a comfortably larger backswing, letting your heel rise higher.';
function Practice({data,frame}:{data:KickSource;frame:number}){
 const pair=getPair(data,1),focus=ease(frame,13,30),step=ease(frame,230,252);
 return <><TopBar detail="EXAMPLE PLAYER 1">Saved practice focus</TopBar>
  <Tag color={C.lime} style={{position:'absolute',left:32,top:124}}>BACKSWING · LEFT FOOT</Tag>
  <div style={{position:'absolute',left:32,top:186,width:824,height:470}}><PosePair pair={pair} seconds={0} paused metric="thighTilt"/></div>
  <div style={{position:'absolute',left:32,right:32,top:166,display:'flex'}}>{['Right foot','Left foot'].map((t,i)=><div key={t} style={{width:'50%',fontSize:28,color:i?C.lime:C.mint}}>{t}</div>)}</div>
  <div style={{position:'absolute',left:32,right:32,top:678,padding:'26px 27px',background:'#122b1e',border:`1px solid ${C.line}`,borderLeft:`4px solid ${C.lime}`,borderRadius:12,opacity:mix(.35,1,focus),transform:`translateY(${12*(1-focus)}px)`}}><div style={{fontSize:36,lineHeight:1.28,fontWeight:600,color:C.lime}}>{savedCue}</div></div>
  <div style={{position:'absolute',left:32,right:32,top:931,fontSize:25,color:C.muted,display:'flex',alignItems:'center',gap:12}}><span style={{color:C.lime,fontSize:31}}>→</span>{step>.5?'Next assessment · pending':'A practice focus to explore with the coach'}</div>
 </>;
}
const stages=['Record','Compare','Practise','Reassess'];
function DevelopmentCycle({data,frame}:{data:KickSource;frame:number}){
 const stage=Math.min(3,Math.floor(frame/49)),next=Math.min(3,stage+1),t=stage<3?ease(frame,stage*49+39,stage*49+49):0;
 const panel=(index:number)=>{
  if(index===0)return <><Tag color={C.lime}>01 · RECORDED ASSESSMENT</Tag><div style={{fontFamily:head,fontSize:63,marginTop:18}}>Right foot. Left foot.</div><div style={{marginTop:32,height:350,width:'100%',background:C.bg}}><Recorded record={getPair(data,1)[1]} frame={75}/></div><Tag style={{marginTop:30}}>Two recordings · one player</Tag></>;
  if(index===1)return <><Tag color={C.lime}>02 · INDIVIDUAL EVIDENCE</Tag><div style={{fontFamily:head,fontSize:64,marginTop:18}}>A visible starting point</div><div style={{display:'flex',gap:30,marginTop:60}}>{[['Right foot','143.2°',C.mint],['Left foot','111.1°',C.lime]].map(([label,value,color])=><div key={label} style={{flex:1}}><Tag color={color}>{label}</Tag><div style={{fontFamily:head,fontSize:92,marginTop:20,color}}>{value}</div></div>)}</div><div style={{marginTop:44,fontSize:29,color:C.muted,lineHeight:1.4}}>Support-knee angle<br/>Recorded backswing · Example player 1</div></>;
  if(index===2)return <><Tag color={C.lime}>03 · FOCUSED PRACTICE</Tag><div style={{fontFamily:head,fontSize:63,marginTop:18}}>Work on one thing.</div><div style={{fontSize:39,lineHeight:1.28,color:C.lime,marginTop:50}}>{savedCue}</div><Tag style={{marginTop:42}}>Saved cue · Example player 1</Tag></>;
  return <><Tag color={C.lime}>04 · REASSESSMENT</Tag><div style={{fontFamily:head,fontSize:64,marginTop:18}}>Record again.</div><div style={{marginTop:44,padding:'28px',border:`1px solid ${C.line}`,borderRadius:13,display:'flex',alignItems:'center',gap:20,fontSize:34}}><span style={{width:18,height:18,border:`2px solid ${C.muted}`,borderRadius:'50%'}}/>Next assessment <span style={{marginLeft:'auto',color:C.lime,fontSize:27}}>Pending</span></div><div style={{fontSize:31,lineHeight:1.5,color:C.muted,marginTop:40}}>Review what changed.<br/>Choose the next focus.</div></>;
 };
 return <><TopBar detail="ILLUSTRATIVE FLOW">Connected development</TopBar>
  <svg width={W} height="175" style={{position:'absolute',top:110,left:0}}><path d="M80 63H808" stroke={C.line} strokeWidth="3"/><path d={`M80 63H${80+(stage+t)*242.66}`} stroke={C.lime} strokeWidth="3"/>{stages.map((s,i)=><g key={s}><circle cx={80+i*242.66} cy="63" r={i===stage?12:7} fill={i<=stage?C.lime:C.panel} stroke={i<=stage?C.lime:C.line} strokeWidth="2"/><text x={80+i*242.66} y="122" textAnchor="middle" fill={i===stage?C.lime:C.muted} fontFamily="Inter" fontSize="26">{s}</text></g>)}</svg>
  <div style={{position:'absolute',left:32,right:32,top:309,height:575,background:'#071b13',border:`1px solid ${C.line}`,borderRadius:18,overflow:'hidden'}}><div style={{position:'absolute',inset:31,opacity:1-ease(t,0,.5),transform:`translateX(${-22*t}px)`}}>{panel(stage)}</div>{t>0&&<div style={{position:'absolute',inset:31,opacity:ease(t,.5,1),transform:`translateX(${22*(1-t)}px)`}}>{panel(next)}</div>}</div>
  <div style={{position:'absolute',left:32,right:32,top:939,display:'flex',justifyContent:'space-between',fontSize:25,color:C.muted}}><span>Player view</span><span style={{color:C.lime}}>↔ Connected platform ↔</span><span>Coach view</span></div>
 </>;
}
type Scene={id:string;start:number;end:number};
const headlines:Record<string,[string,string]>={opening:['WEAK-FOOT DEVELOPMENT','Learning the\nweaker foot.'],'player1-capture':['EXAMPLE PLAYER 1','Right.\nThen left.'],'player1-comparison':['RECORDED COMPARISON','See the\ndifference.'],'player2-capture':['EXAMPLE PLAYER 2','The same process.\nAnother player.'],'player2-comparison':['INDIVIDUAL EVIDENCE','Their movement.\nTheir starting point.'],practice:['EVIDENCE → PRACTICE','A specific\npractice focus.'],cycle:['THE POSETEK VALUE','A repeatable\ndevelopment process.'],identity:['','']};
function Head({scene,opacity=1,y=0}:{scene:Scene;opacity?:number;y?:number}){const [label,title]=headlines[scene.id];return <div style={{position:'absolute',left:72,right:120,top:173,opacity,transform:`translateY(${y}px)`}}><Tag color={C.lime} style={{fontSize:23,letterSpacing:1.6}}>{label}</Tag><div style={{fontFamily:head,fontSize:91,fontWeight:700,whiteSpace:'pre-line',lineHeight:.99,marginTop:20}}>{title}</div></div>;}
function SceneContent({scene,data,frame}:{scene:Scene;data:KickSource;frame:number}){switch(scene.id){case'opening':return <Capture data={data} player={1} frame={0} opening/>;case'player1-capture':return <Capture data={data} player={1} frame={frame}/>;case'player2-capture':return <Capture data={data} player={2} frame={frame}/>;case'player1-comparison':return <Comparison data={data} player={1} frame={frame}/>;case'player2-comparison':return <Comparison data={data} player={2} frame={frame}/>;case'practice':return <Practice data={data} frame={frame}/>;case'cycle':return <DevelopmentCycle data={data} frame={frame}/>;default:return null;}}
export const WeakFootInvestorV1:React.FC<Props>=({audioEnabled=false,captions=[]})=>{
 const f=useCurrentFrame(),data=useKicks(),scenes=timing.scenes,index=scenes.findIndex(s=>f>=s.start&&f<s.end),scene=scenes[index],next=scenes[index+1];if(!data||!scene)return null;
 const visualScene=scene.id==='identity'?scenes[index-1]:scene,local=f-visualScene.start,toEnd=next&&next.id!=='identity'?ease(f,scene.end-16,scene.end):0,identity=ease(f,1694,1730),finalFade=1-ease(f,1785,1800);
 const cap=captions.find(c=>f/30>=c.start&&f/30<c.end);
 const intro=ease(f,0,24),panelY=mix(492,430,ease(f,0,120));
 return <AbsoluteFill style={{background:C.bg,color:C.ink,fontFamily:'Inter,sans-serif',overflow:'hidden'}}><Fonts/>
  <svg width="1080" height="1920" style={{position:'absolute',inset:0,opacity:.5}}><path d="M1005 0V1920" stroke={C.line}/><path d="M0 1747H1080" stroke={C.line}/></svg>
  <div style={{position:'absolute',left:mix(72,246,identity),top:mix(75,768,identity),transform:`scale(${mix(1.08,2.0,identity)})`,transformOrigin:'0 0',opacity:finalFade}}><ExactBrand/></div>
  <Tag style={{position:'absolute',left:72,top:1776,fontSize:19,letterSpacing:1,opacity:1-identity}}>POSETEK / INVESTOR DEMONSTRATION</Tag>
  {identity<1&&<><div style={{opacity:(1-ease(f,1684,1698))*intro}}><Head scene={visualScene} opacity={1-ease(toEnd,0,.48)} y={-8*toEnd}/>{next&&toEnd>0&&<Head scene={next} opacity={ease(toEnd,.52,1)} y={8*(1-toEnd)}/>}</div>
   <div style={{position:'absolute',left:72,top:panelY,width:W,height:H,boxSizing:'border-box',border:`1px solid ${C.line}`,borderRadius:25,background:C.panel,overflow:'hidden',opacity:intro*(1-ease(f,1694,1710)),transform:`translateY(${-24*identity}px) scale(${1-.025*identity})`,transformOrigin:'center center'}}>
    <div style={{position:'absolute',inset:0,opacity:1-ease(toEnd,0,.48),transform:`translateX(${-25*toEnd}px)`}}><SceneContent scene={visualScene} data={data} frame={local}/></div>
    {next&&toEnd>0&&<div style={{position:'absolute',inset:0,opacity:ease(toEnd,.52,1),transform:`translateX(${25*(1-toEnd)}px)`}}><SceneContent scene={next} data={data} frame={0}/></div>}
   </div></>}
  {identity>0&&<div style={{position:'absolute',left:72,right:120,top:959,textAlign:'center',fontFamily:mono,fontSize:35,letterSpacing:2,color:C.muted,opacity:identity*finalFade}}>posetek.net</div>}
  {cap&&<div style={{position:'absolute',left:84,right:132,top:1538,height:132,display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',fontSize:39,fontWeight:400,lineHeight:1.3,whiteSpace:'pre-line',background:C.bg,padding:'0 8px',boxSizing:'border-box'}}>{cap.text}</div>}
  <div style={{position:'absolute',left:72,top:1714,height:3,width:888,background:C.line,opacity:(1-identity)*.75}}><div style={{height:3,width:`${f/1800*100}%`,background:C.lime}}/></div>
  {audioEnabled&&<Audio src={staticFile('audio-weak-foot-v1/master.wav')}/>}
 </AbsoluteFill>;
};
