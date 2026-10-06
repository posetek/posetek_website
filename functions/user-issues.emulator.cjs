// SDK integration only, forcibly restricted to the local demo emulator.
const assert = require('node:assert/strict');
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):\d+$/);
const admin = require('firebase-admin');
const {createUserIssues} = require('./user-issues');
const {HttpsError} = require('firebase-functions').https;
const app = admin.initializeApp({projectId:'demo-user-issues'},'issue-test');
const db = app.firestore();
(async()=>{
  const at=Date.now(), sends=[];
  const service=createUserIssues({db,HttpsError,provider:{send:async p=>{sends.push(p);return {id:'test-email'};}}});
  await db.doc('userIssueSettings/current').set({enabled:true,sendEnabled:true,activatedAtMillis:at-1000});
  const input={eventId:'sdk-event',sessionId:'sdk-session',operation:'save',code:'unavailable',kind:'error',occurredAtMillis:at};
  const results=await Promise.all([1,2,3].map(()=>service.submit(input,{uid:'sdk-user'})));
  assert.equal(new Set(results.map(r=>r.occurrenceId)).size,1);
  const auth={uid:'admin',email:'admin@posetek.net',emailVerified:true};
  const list=await service.list({actorUid:'sdk-user'},auth);
  assert.equal(list.issues.length,1);
  const detail=await service.list({issueId:results[0].reference},auth);
  assert.equal(detail.occurrences.length,1);
  await service.sweep(); assert.equal(sends.length,1); await service.sweep(); assert.equal(sends.length,1);
  console.log('User issue SDK integration: concurrent intake, actor/detail queries and due queue passed');
})().finally(()=>app.delete()).catch(e=>{console.error(e);process.exitCode=1});
