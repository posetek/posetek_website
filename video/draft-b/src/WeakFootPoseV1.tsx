import React,{useEffect,useState} from 'react';
import {cancelRender,continueRender,delayRender,staticFile} from 'remotion';
export type Point=(number|null)[];
export type KickRecord={key:string;foot:'right'|'left';fps:number;width:number;height:number;frames:Point[][];contactFrame:number;backswingFrame:number;followThroughFrame:number;direction:string;metrics:{supportKnee:number;thighTilt:number};video:{src:string;durationSeconds:number}};
export type KickSource={version:number;records:KickRecord[]};
export const WK={bg:'#04130e',panel:'#0a211a',lime:'#b7f34a',mint:'#a8e4d7',ink:'#f0f5ed',muted:'#a9bdb1',line:'#254036'};
export const visible=(p?:Point):p is number[]=>Boolean(p&&typeof p[0]==='number'&&Number.isFinite(p[0])&&typeof p[1]==='number'&&Number.isFinite(p[1])&&(p[3]??1)>=.1);
let pending:Promise<KickSource>|null=null;
export function useKicks(){const [data,setData]=useState<KickSource|null>(null);const [handle]=useState(()=>delayRender('Verified weak-foot recordings'));
 useEffect(()=>{let alive=true;pending??=fetch(staticFile('weak-foot-v1/poses.json')).then(r=>{if(!r.ok)throw Error('Prepare weak-foot-v1 assets first');return r.json();});pending.then(d=>{if(alive)setData(d);continueRender(handle);}).catch(cancelRender);return()=>{alive=false;};},[handle]);return data;}
const EDGES=[[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32]];
const BONES=[[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28],[11,23],[12,24]];
const median=(a:number[])=>{const s=a.slice().sort((x,y)=>x-y);return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;};
function boneLengths(r:KickRecord){return BONES.map(([a,b])=>{const values:number[]=[];for(let f=r.contactFrame-48;f<=r.contactFrame+12;f++){const p=r.frames[f]?.[a],q=r.frames[f]?.[b];if(visible(p)&&visible(q))values.push(Math.hypot((p[0]-q[0])*r.width/r.height,p[1]-q[1]));}return values.length>=5?median(values):null;});}
export function pairProjection(pair:KickRecord[],width:number,height:number,phaseOnly=false){
 const lengths=pair.map(boneLengths),ratios=lengths[0].flatMap((n,i)=>n&&lengths[1][i]?[Math.log(n/lengths[1][i]!)]:[]);if(ratios.length<3)throw Error('Insufficient fixed body-scale evidence');
 const ratio=Math.exp(median(ratios));
 const anchor=pair.map(r=>{const p=r.frames[r.contactFrame][r.foot==='right'?27:28];if(!visible(p))throw Error('Missing support-foot anchor');return p;});
 const normal=(r:KickRecord,p:number[],i:number):[number,number]=>[(p[0]-anchor[i][0])*r.width/r.height*(i?ratio:1)*(r.foot==='left'?-1:1),(p[1]-anchor[i][1])*(i?ratio:1)];
 const points=pair.flatMap((r,i)=>{const frames=phaseOnly?[r.frames[r.backswingFrame]]:r.frames.slice(Math.floor(r.contactFrame-r.fps*.25),Math.ceil(r.contactFrame+r.fps*.45));if(!phaseOnly)frames.push(r.frames[r.backswingFrame]);return frames.flat().filter(visible).map(p=>normal(r,p,i));});
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 const scale=Math.min((width-58)/(maxX-minX),(height-58)/(maxY-minY));
 return pair.map((r,i)=>({ground:height-29-maxY*scale,point:(p:number[]):[number,number]=>{const [x,y]=normal(r,p,i);return [width/2+(x-(minX+maxX)/2)*scale,height-29+(y-maxY)*scale];}}));
}
export function poseIndex(r:KickRecord,seconds:number){return Math.max(0,Math.min(r.frames.length-1,Math.round(r.contactFrame+seconds*r.fps)));}
export function KickSkeleton({points,project,color,highlight=[]}:{points:Point[];project:(p:number[])=>[number,number];color:string;highlight?:number[]}){
 return <g>{EDGES.map(([a,b])=>{const p=points[a],q=points[b];if(!visible(p)||!visible(q))return null;const [x1,y1]=project(p),[x2,y2]=project(q),lit=highlight.includes(a)&&highlight.includes(b);return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={lit?WK.ink:color} strokeWidth={lit?6:a<11?1.7:3.8} strokeLinecap="round" opacity={highlight.length&&!lit?.55:1}/>;})}
 {points.map((p,i)=>{if(!visible(p))return null;const [x,y]=project(p),lit=highlight.includes(i);return <g key={i}>{lit&&<circle cx={x} cy={y} r={13} fill={WK.bg} fillOpacity=".6" stroke={color} strokeWidth="1.8"/>}<circle cx={x} cy={y} r={lit?4.5:i<11?1.8:3} fill={lit?WK.ink:color}/></g>;})}</g>;
}
export function PosePair({pair,seconds,paused=false,metric='supportKnee',width=824,height=470}:{pair:KickRecord[];seconds:number;paused?:boolean;metric?:'supportKnee'|'thighTilt';width?:number;height?:number}){
 const w=width/2,projections=pairProjection(pair,w,height,paused);
 return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}><defs><pattern id="weak-foot-grid" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0H0V44" fill="none" stroke={WK.line} strokeWidth=".65"/></pattern></defs><rect width={width} height={height} fill="url(#weak-foot-grid)" opacity=".32"/>
  {pair.map((r,i)=>{const index=paused?r.backswingFrame:poseIndex(r,seconds),highlight=paused?(metric==='supportKnee'?(r.foot==='right'?[23,25,27]:[24,26,28]):(r.foot==='right'?[24,26]:[23,25])):[];return <g key={r.key} transform={`translate(${i*w} 0)`}><line x1="17" y1={projections[i].ground} x2={w-17} y2={projections[i].ground} stroke={WK.line}/><KickSkeleton points={r.frames[index]} project={projections[i].point} color={i?WK.lime:WK.mint} highlight={highlight}/></g>;})}
 </svg>;
}
