"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { TENANT, CLIENT, CALLER, endpointHash, mailReadBinding, createMailReadProxyTransport, createConfiguredMailReader } = require("./issue-tracker-mail-read-proxy");
const { createGraphReader, safeGraphUrl, MAILBOX } = require("./issue-tracker-graph-reader");
const { createFlowTokenProvider, FLOW_SCOPE } = require("./issue-tracker-bridge-transport");
const ENDPOINT = "https://test.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/1234567890abcdef1234567890abcdef/triggers/manual/paths/invoke?api-version=1";
const URL = "https://graph.microsoft.com/v1.0/users/dylank%40posetek.net/messages", UUID = "11111111-2222-4333-8444-555555555555";
const WINDOW = { since: "2026-10-02T00:00:00Z", until: "2026-10-02T01:00:00Z" };
const message = (id = "immutable") => ({ id, subject: "PoseTek error", receivedDateTime: "2026-10-02T00:30:00Z", body: { contentType: "html", content: "<p>Complete evidence</p>" }, internetMessageHeaders: [{name:"X-Example",value:"preserved"}], isRead:true, parentFolderId:"non-inbox" });
const proxySettings = () => ({ mailbox: MAILBOX, mailReadProvider: "power_automate", graphMailboxVerified: false, mailReadProxyVerified: true,
  mailReadProxyProof: { schemaVersion:1, verified:true, authorization:"delegated_proxy_route", tenantId:TENANT, clientId:CLIENT, callerObjectId:CALLER,
    connectionAccount:MAILBOX, flowId:UUID, connectionName:"shared-office365-"+UUID, endpointSha256:endpointHash(ENDPOINT), exportSha256:"a".repeat(64) } });
const ok = data => ({status:200,ok:true,json:async()=>data});
function fixture(overrides={}) {
  const calls=[],settings=proxySettings(); let tokenCalls=0;
  const reply=data=>({schemaVersion:1,requestId:UUID,mailbox:MAILBOX,graphStatus:200,data});
  const args={endpoint:async()=>ENDPOINT,configuration:async()=>settings,identity:async()=>({tenantId:TENANT,clientId:CLIENT}),randomId:()=>UUID,
    getAccessToken:async()=>{tokenCalls++;return "private-token";},fetchImpl:async(...call)=>{calls.push(call);return ok(reply({value:[message()]}));},...overrides};
  return {settings,calls,reply,args,request:createMailReadProxyTransport(args),tokenCalls:()=>tokenCalls};
}
test("proxy reuses the tested Flow OAuth resource and binds exact synchronous read envelope",async()=>{
  const requests=[];
  const provider=createFlowTokenProvider({credentials:async()=>({tenantId:TENANT,clientId:CLIENT,clientSecret:"synthetic-only-never-a-live-secret"}),fetchImpl:async(url,req)=>{
    requests.push({url,req});assert.equal(new URLSearchParams(req.body).get("scope"),"https://service.flow.microsoft.com//.default");return ok({access_token:"synthetic-token-never-live",token_type:"Bearer",expires_in:3600});}});
  assert.equal(FLOW_SCOPE,"https://service.flow.microsoft.com//.default");
  const f=fixture({getAccessToken:provider}); const result=await f.request(URL);
  assert.deepEqual(result,{value:[message()]}); assert.equal(requests.length,1);
  const [target,options]=f.calls[0];assert.equal(target,ENDPOINT);assert.equal(options.method,"POST");assert.equal(options.redirect,"error");
  assert.equal(options.headers.Authorization,"Bearer synthetic-token-never-live");assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(options.body),{schemaVersion:1,requestId:UUID,url:URL});
  await f.request(URL);assert.equal(requests.length,1);
});
test("proxy pagination preserves opaque nextLink, full HTML and headers without Inbox/read filtering",async()=>{
  const next=URL.replace("%40","@")+"?$skiptoken=opaque%2B%2F%3D%252F&$top=1", urls=[];
  const f=fixture();f.args.fetchImpl=async(_,req)=>{const body=JSON.parse(req.body);urls.push(body.url);return ok(f.reply(urls.length===1?{value:[message("one")],"@odata.nextLink":next}:{value:[message("two")]}));};
  const reader=createGraphReader({requestJson:createMailReadProxyTransport(f.args)});
  const first=await reader.page(WINDOW),second=await reader.page({...WINDOW,cursor:first.cursor});
  assert.equal(urls[1],next);assert.equal(first.complete,false);assert.equal(second.complete,true);
  assert.deepEqual(first.records[0].internetMessageHeaders,message().internetMessageHeaders);assert.equal(first.records[0].body.content,message().body.content);
  assert.equal(first.records[0].isRead,true);assert.equal(first.records[0].parentFolderId,"non-inbox");
  assert.match(urls[0],/receivedDateTime/);assert.doesNotMatch(new global.URL(urls[0]).searchParams.get("$filter"),/isRead|mailFolders|sender|subject/);
});
test("URL validation rejects hostile paths before credentials or network but preserves accepted query bytes",async()=>{
  const bad=[URL.replace("dylank","nolanj"),URL.replace("dylank","taiyow"),URL.replace("dylank","alerts"),URL.replace("/users/dylank%40posetek.net","/me"),
    URL.replace("graph.microsoft.com","graph.microsoft.com:443"),URL.replace("graph.microsoft.com","user@graph.microsoft.com"),URL.replace("https:","http:"),
    URL+"#fragment",URL+"/../messages",URL+"/%2e%2e",URL+"/%252f",URL+"/one/two",URL+"\\other",URL+"?$skiptoken=raw value",URL+"\n",URL+"/one%40two",URL+"/one%3Ftwo"];
  for(const url of bad){const f=fixture();await assert.rejects(f.request(url,{item:true}),{code:"tracker_graph_invalid_page"});assert.equal(f.tokenCalls(),0);assert.equal(f.calls.length,0);}
  assert.equal(safeGraphUrl(URL+"?$skiptoken=%2F..%252F%40%23%20"),URL+"?$skiptoken=%2F..%252F%40%23%20");
  assert.equal(safeGraphUrl(URL+"/A_B-c%2BD%3D",true),URL+"/A_B-c%2BD%3D");
  assert.equal(safeGraphUrl(URL+"/A%2FB%2fC%3D",true),URL+"/A%2FB%2fC%3D");
  assert.throws(()=>safeGraphUrl(URL+"/message"),{code:"tracker_graph_invalid_page"});
});
test("wrong endpoint, runtime identity and unverified authorization proof refuse before token/network",async()=>{
  for(const change of [s=>delete s.mailReadProvider,s=>s.mailReadProxyVerified=false,s=>s.mailReadProxyProof.authorization="application_rbac",s=>s.mailReadProxyProof.callerObjectId=UUID,s=>s.mailReadProxyProof.endpointSha256="b".repeat(64),s=>s.mailReadProxyProof.connectionAccount="nolanj@posetek.net"]){
    const f=fixture();change(f.settings);await assert.rejects(f.request(URL),{code:"tracker_mail_proxy_not_configured"});assert.equal(f.calls.length,0);assert.equal(f.tokenCalls(),0);
  }
  const f=fixture({identity:async()=>({tenantId:UUID,clientId:CLIENT})});await assert.rejects(f.request(URL),{code:"tracker_mail_proxy_not_configured"});assert.equal(f.tokenCalls(),0);
  assert.equal(mailReadBinding({mailbox:MAILBOX,graphMailboxVerified:true}),null);
  assert.ok(mailReadBinding(proxySettings()));assert.ok(mailReadBinding({mailbox:MAILBOX,mailReadProvider:"graph",graphMailboxVerified:true}));
});
test("async, denied, throttled, timeout and malformed responses never count as completed reads",async()=>{
  for(const [status,code] of [[202,"tracker_mail_proxy_read_failed"],[401,"tracker_graph_access_denied"],[403,"tracker_graph_access_denied"],[404,"tracker_graph_message_unavailable"],[429,"tracker_graph_throttled"],[500,"tracker_mail_proxy_read_failed"]]){
    const f=fixture({fetchImpl:async()=>({status,json:async()=>{throw Error("must not read");}})});await assert.rejects(f.request(URL),{code});
  }
  const timed=fixture({fetchImpl:async()=>{throw Error("private transport diagnostic");}});await assert.rejects(timed.request(URL),{code:"tracker_mail_proxy_unavailable"});
  const broken=fixture({fetchImpl:async()=>({status:200,json:async()=>{throw Error("truncated body");}})});await assert.rejects(broken.request(URL),{code:"tracker_mail_proxy_invalid_response"});
  for(const mutate of [r=>null,r=>({...r,requestId:"stale"}),r=>({...r,mailbox:"other@posetek.net"}),r=>({...r,graphStatus:202}),r=>({...r,extra:"untrusted"}),r=>({...r,data:[]}),r=>({...r,data:{error:"not a page"}})]){
    const f=fixture();f.args.fetchImpl=async()=>ok(mutate(f.reply({value:[]})));await assert.rejects(createMailReadProxyTransport(f.args)(URL),{code:"tracker_mail_proxy_invalid_response"});
  }
});
test("Graph shape validation still rejects truncated message and hostile returned nextLink after proxy success",async()=>{
  for(const data of [{value:[{id:"incomplete"}]},{value:[],"@odata.nextLink":URL.replace("dylank","taiyow")},{}]){
    const f=fixture();f.args.fetchImpl=async()=>ok(f.reply(data));const reader=createGraphReader({requestJson:createMailReadProxyTransport(f.args)});await assert.rejects(reader.page(WINDOW));
  }
});
test("revoked or changed proxy proof during read refuses returned evidence; explicit Graph route never falls back",async()=>{
  for(const change of [s=>s.mailReadProxyVerified=false,s=>s.mailReadProxyProof.exportSha256="b".repeat(64)]){
    const f=fixture();f.args.fetchImpl=async()=>{change(f.settings);return ok(f.reply({value:[]}));};await assert.rejects(createMailReadProxyTransport(f.args)(URL),{code:"tracker_capture_configuration_changed"});
  }
  let app=0,proxy=0;const settings={mailbox:MAILBOX,mailReadProvider:"graph",graphMailboxVerified:true};
  const reader=createConfiguredMailReader({configuration:async()=>settings,graph:{page:async()=>{app++;throw Object.assign(Error("denied"),{code:"tracker_graph_access_denied"});}},proxyRequest:async()=>{proxy++;}});
  await assert.rejects(reader.page(WINDOW),{code:"tracker_graph_access_denied"});assert.equal(app,1);assert.equal(proxy,0);
  settings.mailReadProvider="missing";await assert.rejects(reader.page(WINDOW),{code:"tracker_mail_not_configured"});assert.equal(app,1);
});
test("mail proxy endpoint is bound only to arrival/source capture and is included in isolated source package",()=>{
  const source=fs.readFileSync(require.resolve("./issue-tracker-bridge-entrypoints"),"utf8");
  assert.equal((source.match(/secrets: mailReadSecrets/g)||[]).length,1);assert.equal((source.match(/\.\.\.mailReadSecrets/g)||[]).length,1);
  const writer=source.split("drainUserIssueTracker: functions.runWith")[1].split("ingestUserIssueTrackerMail:")[0];assert.doesNotMatch(writer,/MAIL_READ/);
  assert.match(fs.readFileSync(require.resolve("../deployments/issue-tracker/prepare.cjs"),"utf8"),/issue-tracker-mail-read-proxy\.js/);
});
