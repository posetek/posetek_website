#!/usr/bin/env node
'use strict';
// Offline only. Converts an actual cloud inspection/initialization export plus
// explicit reviewed mappings into disabled backend seed documents. No uploads.
const fs=require('node:fs');const path=require('node:path');
const {HEADERS,LINK_HEADERS,KEY_HEADERS,machineRowSha256,normalizeIssueTracker,canonicalJson}=require('../../functions/issue-tracker-normalize');
const {splitSeed}=require('../../functions/issue-tracker-bridge-seed');
const {digest}=require('../../functions/issue-tracker-bridge-model');
const GROUPS=['actions','instances','emails','dailyRows'];
function ensure(condition,message){if(!condition)throw new Error('Bootstrap seed: '+message);}
function convertBootstrapSeed(snapshot,review){
  ensure(review?.schemaVersion===1&&review.reviewed===true,'explicit reviewed mapping file required');
  ensure(typeof review.workbookKey==='string'&&review.workbookKey&&typeof review.mailbox==='string'&&review.mailbox,'workbook/mailbox required');
  ensure(/^[a-f0-9]{64}$/.test(snapshot.sourceSha256||'')&&review.sourceSha256===snapshot.sourceSha256,'mapping review is not bound to this native snapshot');
  ensure(!snapshot.workbookKey||snapshot.workbookKey===review.workbookKey,'workbook key mismatch');
  ensure(Array.isArray(snapshot.seed),'native seed export missing');
  const rows=Object.fromEntries(GROUPS.map(group=>[group,Object.create(null)]));
  const groups=new Set();
  for(const group of snapshot.seed){
    ensure(GROUPS.includes(group.group)&&!groups.has(group.group),'duplicate/unknown export group');groups.add(group.group);
    for(const row of group.rows){
      ensure(typeof row.key==='string'&&row.key&&!Object.hasOwn(rows[group.group],row.key),'duplicate/blank source key');
      ensure(canonicalJson(Object.keys(row.values).sort())===canonicalJson([...HEADERS[group.group]].sort()),'machine headers changed');
      ensure(canonicalJson(Object.keys(row.links).sort())===canonicalJson([...LINK_HEADERS[group.group]].sort()),'link headers changed');
      ensure(row.values[KEY_HEADERS[group.group]]===row.key,'stable source key mismatch');
      ensure(machineRowSha256(row)===row.machineSha256,'native machine hash mismatch');
      const rowId=group.group==='instances'?row.values.Instance:group.group==='emails'?row.values.Email:row.key;
      rows[group.group][row.key]={rowId,hash:row.machineSha256,values:row.values,links:row.links,...(['instances','emails'].includes(group.group)?{actionId:row.values['Action ID']}:{})};
    }
  }
  ensure(['actions','instances','emails'].every(group=>groups.has(group)),'one of the three canonical tables is absent');
  if(!groups.has('dailyRows')){
    const header=['Reporting day','Job created (Pacific)','Delivery','Provider code','Job reference'];
    const footer=snapshot.footerValues;ensure(Array.isArray(footer),'reviewed native footer missing');
    const start=footer.findIndex(row=>canonicalJson(row.slice(0,5))===canonicalJson(header));ensure(start>=0,'daily footer header absent');
    for(let i=start+1;i<footer.length&&footer[i][4]!=='';i++){
      const values=Object.fromEntries(header.map((h,j)=>[h,footer[i][j]])),key=values['Job reference'];
      ensure(typeof key==='string'&&key&&!Object.hasOwn(rows.dailyRows,key),'duplicate/blank daily key');
      rows.dailyRows[key]={rowId:key,values,links:{},hash:machineRowSha256({values,links:{}})};
    }
  }
  const counts=Object.fromEntries(GROUPS.map(group=>[group,Object.keys(rows[group]).length]));
  for(const group of ['actions','instances','emails'])ensure(snapshot.counts[group]===counts[group],'native count mismatch');
  if(snapshot.counts.dailyRows!==undefined)ensure(snapshot.counts.dailyRows===counts.dailyRows,'daily count mismatch');
  const actionMappings=review.actionMappings;ensure(actionMappings&&typeof actionMappings==='object'&&!Array.isArray(actionMappings),'explicit action mapping dictionary required');
  for(const actionId of Object.values(actionMappings))ensure(Object.hasOwn(rows.actions,actionId),'reviewed mapping points to missing Action ID');
  const displayToOccurrence=new Map(),emailAliases={},emailLinks={},providerOccurrences={},outboxOccurrences={};
  for(const [key,row] of Object.entries(rows.instances)){
    ensure(!displayToOccurrence.has(row.rowId),'duplicate instance display ID');displayToOccurrence.set(row.rowId,key);outboxOccurrences[key]=key;
    const provider=row.values['Provider email ID'];if(provider){ensure(!Object.hasOwn(providerOccurrences,provider)||providerOccurrences[provider]===key,'provider ID maps to multiple occurrences');providerOccurrences[provider]=key;}
  }
  for(const [key,row] of Object.entries(rows.emails)){
    emailAliases[digest([review.mailbox.toLowerCase(),key])]=key;
    const linked=row.values['Linked instance'],eventRef=displayToOccurrence.get(linked);
    if(eventRef){row.eventRef=eventRef;(emailLinks[eventRef]||=[]).push(row.rowId);}
    else ensure(!/^EV-\d+$/.test(linked),'email points to a missing native instance');
  }
  const logical={schemaVersion:1,mailbox:review.mailbox.toLowerCase(),counts,actionMappings,rows,emailAliases,emailLinks,providerOccurrences,outboxOccurrences};
  // Reuse the production pure adapter's ID/counter/hash validation with no input.
  const checked=normalizeIssueTracker({seed:logical});ensure(Object.values(checked.changes).every(group=>group.length===0),'seed inspection emitted unexpected changes');
  const split=splitSeed(checked.nextSeed);
  return {candidateOnly:true,sourceSha256:snapshot.sourceSha256,nativeInitialized:snapshot.initialized===true,settings:{enabled:false,seedVerified:false,connectionVerified:false,workbookKey:review.workbookKey,mailbox:review.mailbox.toLowerCase()},writer:{revision:snapshot.initialized===true?snapshot.revision:0,activeBatchId:null,leaseId:null,leaseUntilMillis:0},seedMetadata:split.metadata,rowDocuments:split.changedRows.map(row=>({path:`issueTrackerRows/${row.id}`,data:{group:row.group,key:row.key,value:row.value}}))};
}
module.exports={convertBootstrapSeed};
if(require.main===module){
  const [snapshotPath,reviewPath,outputPath]=process.argv.slice(2);ensure(snapshotPath&&reviewPath&&outputPath,'Usage: node convert-bootstrap-seed.cjs NATIVE_EXPORT.json REVIEWED_MAP.json .netlify/SEED.json');
  const output=path.resolve(outputPath),privateRoot=path.resolve(__dirname,'../../.netlify')+path.sep;ensure(output.startsWith(privateRoot),'private seed output must remain in ignored .netlify');
  const result=convertBootstrapSeed(JSON.parse(fs.readFileSync(snapshotPath,'utf8')),JSON.parse(fs.readFileSync(reviewPath,'utf8')));fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({candidateOnly:true,enabled:false,rows:result.rowDocuments.length,output}));
}
