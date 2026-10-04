#!/usr/bin/env node
'use strict';
// Explicit, bounded import of existing manifests. Default is a read-only plan.
// Credentials stay in memory; only server-owned performance collections change.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const {createRequire}=require('node:module');
const requireFunctions=createRequire(path.resolve(__dirname,'../functions/package.json'));
const {Firestore,FieldValue,FieldPath}=requireFunctions('@google-cloud/firestore');
const {OAuth2Client}=requireFunctions('google-auth-library');
const {normalizeManifest,createDiagnosticPerformance,createDeviceProcessingReports,BUCKET,ROOT,INVENTORY,LIMITS}=require('../functions/device-processing');
const {completeQuery,mapBounded}=require('../functions/insights-v2-projection');
class ImportError extends Error {constructor(code,message){super(message);this.code=code;}}
const PROJECT='kickai-69dd0';
const sourceHash=()=>createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../functions/device-processing.js'))).digest('hex');
function connect(){
 const token=execFileSync('gcloud',['auth','print-access-token','--project',PROJECT],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const authClient=new OAuth2Client();authClient.setCredentials({access_token:token,expiry_date:Date.now()+45*60000});
 const db=new Firestore({projectId:PROJECT,authClient});
 async function storage(name,query={}){
  const url=new URL(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(name)}`);for(const[k,v]of Object.entries(query))url.searchParams.set(k,v);
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
  if(!response.ok)throw Object.assign(new Error(`Storage HTTP ${response.status}`),{code:response.status});
  if(query.alt!=='media')return response.json();
  let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>LIMITS.manifestBytes){await response.body.cancel().catch(()=>{});throw Error('Manifest exceeds byte limit');}chunks.push(chunk);}
  return Buffer.concat(chunks);
 }
 const bucket={file:(name,{generation})=>({download:async()=>[await storage(name,{generation,alt:'media'})]})};
 return {db,bucket,metadata:name=>storage(name)};
}
async function collect(db,start,end){
 const rows=new Map();
 for(const field of ['occurredAt','createdAt','updatedAt']){
  let last=null,count=0;
  while(true){let q=db.collection('processingAttempts').where(field,'>=',new Date(start)).where(field,'<',new Date(end)).orderBy(field).orderBy(FieldPath.documentId()).limit(100);if(last)q=q.startAfter(last);
   const page=await q.get();for(const doc of page.docs){rows.set(doc.id,{id:doc.id,...doc.data()});count++;}if(count>5000)throw Error('Narrow import range: query exceeds 5000 records');if(page.docs.length<100)break;last=page.docs.at(-1);
  }
 }
 return [...rows.values()];
}
function writePrivate(file,value){if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('Refuse symlink output');fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});}
async function main(){
 const args=process.argv.slice(2),get=key=>args[args.indexOf(key)+1],apply=args.includes('--apply'),output=get('--output');
 if(!args.includes('--output')||!output)throw Error('Provide --output /private/path.json');
 const {db,bucket,metadata}=connect();
 try{
  if(!apply){
   const allIndexed=args.includes('--all-indexed'),onlyMissing=args.includes('--only-missing');
   const start=allIndexed?null:get('--from'),end=allIndexed?null:get('--until');if(!allIndexed&&(!args.includes('--from')||!args.includes('--until')||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start)||Date.parse(end)-Date.parse(start)>7*86400000))throw Error('Provide an explicit --from and --until range of at most 7 days, or --all-indexed');
   let indexes=allIndexed?(await completeQuery(db.collection('processingAttempts'),5000,ImportError)).map(d=>({id:d.id,...d.data()})):await collect(db,start,end);
   const indexedTotal=indexes.length;
   if(onlyMissing){const summaries=new Set((await completeQuery(db.collection(ROOT).select('summaryVersion'),5000,ImportError)).map(d=>d.id));indexes=indexes.filter(x=>!summaries.has(x.id));}
   const objects=[],rejected=[];let runs=0;const installs=new Set();
   await mapBounded(indexes,6,async index=>{if(!index.manifestPath){rejected.push({attemptId:index.id,reason:'noManifest'});return;}try{
    const object=await metadata(index.manifestPath);if(Number(object.size)>LIMITS.manifestBytes)throw Error('Manifest too large');
    const [bytes]=await bucket.file(object.name,{generation:object.generation}).download();
    const digest=createHash('sha256').update(bytes).digest('hex');if(object.metadata?.sha256&&object.metadata.sha256!==digest)throw Error('Digest mismatch');
    const summary=normalizeManifest(JSON.parse(bytes),index,{path:object.name,generation:object.generation});
    objects.push({name:object.name,bucket:BUCKET,generation:object.generation,size:object.size,metadata:{sha256:digest},attemptId:index.id,runs:summary.runs.length});
    runs+=summary.runs.length;for(const r of summary.runs)if(r.installId)installs.add(r.installId);
   }catch(e){rejected.push({attemptId:index.id,reason:e.code||e.message});}});
   const plan={schemaVersion:1,mode:'readOnlyPlan',project:PROJECT,sourceHash:sourceHash(),createdAt:new Date().toISOString(),start,end,allIndexed,onlyMissing,indexedTotal,collections:[ROOT,INVENTORY],candidates:indexes.length,objects,rejected,runs,installIds:[...installs]};writePrivate(output,plan);console.log(JSON.stringify({mode:plan.mode,candidates:plan.candidates,ready:objects.length,rejected:rejected.length,runs,phones:installs.size,output}));
  }else{
   if(!args.includes('--plan'))throw Error('Apply requires a reviewed --plan file');const plan=JSON.parse(fs.readFileSync(get('--plan'),'utf8'));
   if(plan.mode!=='readOnlyPlan'||plan.project!==PROJECT||plan.sourceHash!==sourceHash()||plan.objects.length>5000)throw Error('Plan/project/source mismatch; prepare a fresh plan');
   const importer=createDiagnosticPerformance({db,bucket,FieldValue}),results=[];
   for(const object of plan.objects)results.push(await importer.importObject(object));
   writePrivate(output,{project:PROJECT,sourceHash:sourceHash(),appliedAt:new Date().toISOString(),plan:get('--plan'),results});
   console.log(JSON.stringify({mode:'applied',counts:results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),output}));
  }
 }finally{await db.terminate();}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={connect,collect,writePrivate};
