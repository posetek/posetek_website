/** PoseTek native Excel writer candidate. Paste into Office Scripts, then call
 * main(workbook, string(triggerBody())) from ONE serialized Power Automate flow.
 * No network access, no whole-file replacement, and no user-field writes.
 * Requires reviewed bootstrap. See CONTRACT.md for cutover and limitations.
 */
type Cell = string | number | boolean;
interface Fields { [key: string]: Cell }
interface Links { [key: string]: string }
interface RowChange { key: string; expectedMachineSha256: string | null; values: Fields; links: Links }
interface Changes { actions: RowChange[]; instances: RowChange[]; emails: RowChange[]; dailyRows: RowChange[] }
interface Envelope { schemaVersion: number; batchId: string; workbookKey: string; payloadSha256: string; expectedRevision: number; generatedAt: string; changes: Changes }
interface SourceKeys { actions: string[]; instances: string[]; emails: string[]; dailyRows: string[] }
interface Counts { actions: number; instances: number; emails: number; dailyRows: number }
interface Receipt { schemaVersion: number; batchId: string; workbookKey: string; payloadSha256: string; verified: boolean; revision: number; applied: SourceKeys; counts: Counts }
interface SyncState { schemaVersion: number; workbookKey: string; revision: number; mode: string; pendingBatchId: string; pendingPayloadSha256: string; pendingExpectedRevision: number; initialCounts: Counts }
interface Spec { group: string; table: string; sheet: string; row: number; column: number; headers: string[]; key: string; human: string[]; calculated: string[]; linkColumns: string[]; displayKey: string }
interface RowImage { key: string; values: Fields; links: Links; human: Fields; formulas: Fields }
interface TableImage { spec: Spec; rows: RowImage[] }
interface PlannedRow { change: RowChange; existed: boolean; alreadyApplied: boolean }
interface TablePlan { spec: Spec; updates: PlannedRow[]; existingKeys: string[]; human: { [key: string]: Fields } }

const ACTION_HEADERS = ['Action ID','Priority','Problem','Who / impact','Records','Emails','Status','Recommended next step','Observed evidence / limits','Retest and safe recovery','Owner','Due (Pacific)','Fix notes','Code / evidence','Provider reference'];
const INSTANCE_HEADERS = ['Instance','Occurred (Pacific)','User who acted / reported','Target athlete','Attempted action','Error / actual evidence','Action ID','Email delivery','Recommended next step','Recorded operation','Identity basis','Recorded actor UID','Target player ID','Page / device','Received (Pacific)','Email IDs','Correlation / limits','Private issue','Source record','Build','Request / job ID','Occurrence ID','Provider email ID','Delivery error code'];
const EMAIL_HEADERS = ['Email','Received (Pacific)','Message type','Function / operation','Linked instance','Action ID','Original affected-user label','Message / linked diagnosis','Outlook source','Issue / service incident','Monitoring incident ID','Original subject','Outlook message ID'];
const DAILY_HEADERS = ['Reporting day','Job created (Pacific)','Delivery','Provider code','Job reference'];
const SPECS: Spec[] = [
  {group:'actions',table:'ActionTracker',sheet:'Actions',row:8,column:0,headers:ACTION_HEADERS,key:'Action ID',human:['Status','Owner','Due (Pacific)','Fix notes'],calculated:['Records','Emails'],linkColumns:['Code / evidence','Provider reference'],displayKey:'Action ID'},
  {group:'instances',table:'IncidentInstances',sheet:'Instances',row:4,column:0,headers:INSTANCE_HEADERS,key:'Occurrence ID',human:[],calculated:['Recommended next step'],linkColumns:['Private issue'],displayKey:'Instance'},
  {group:'emails',table:'EmailEvidence',sheet:'Emails',row:4,column:0,headers:EMAIL_HEADERS,key:'Outlook message ID',human:[],calculated:[],linkColumns:['Outlook source','Issue / service incident'],displayKey:'Email'},
  {group:'dailyRows',table:'DailyDeliveries',sheet:'Instances',row:4,column:25,headers:DAILY_HEADERS,key:'Job reference',human:[],calculated:[],linkColumns:[],displayKey:'Job reference'}
];
const RECEIPT_HEADERS = ['Batch ID','Payload SHA256','Revision','Receipt JSON'];
const MAX_CHANGES = 150;
const MAX_RECEIPTS = 1000;

function requireCondition(ok: boolean, message: string): asserts ok { if (!ok) throw new Error(message); }
function same(a: object | Cell | null, b: object | Cell | null): boolean { return canonical(a) === canonical(b); }
// JSON contains only finite numbers, booleans, strings, null, arrays and objects.
function canonical(value: object | Cell | null): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {const array=value as (object | Cell | null)[];return '[' + array.map(v => canonical(v)).join(',') + ']';}
  const object = value as { [key: string]: object | Cell | null };
  return '{' + Object.keys(object).sort().map(k => JSON.stringify(k)+':'+canonical(object[k])).join(',') + '}';
}
/** Standalone SHA-256 using UTF-8 bytes; no unavailable crypto/fetch APIs. */
function sha256(text: string): string {
  const bytes: number[] = [];
  for (let i=0;i<text.length;i++) {
    let cp=text.charCodeAt(i);
    if(cp>=0xd800&&cp<=0xdbff&&i+1<text.length){const low=text.charCodeAt(i+1);if(low>=0xdc00&&low<=0xdfff){cp=0x10000+((cp-0xd800)<<10)+(low-0xdc00);i++;}}
    if(cp>=0xd800&&cp<=0xdfff)cp=0xfffd;
    if(cp<128)bytes.push(cp);else if(cp<2048)bytes.push(192|(cp>>6),128|(cp&63));else if(cp<65536)bytes.push(224|(cp>>12),128|((cp>>6)&63),128|(cp&63));else bytes.push(240|(cp>>18),128|((cp>>12)&63),128|((cp>>6)&63),128|(cp&63));
  }
  const bitLength=bytes.length*8;bytes.push(128);while(bytes.length%64!==56)bytes.push(0);
  const high=Math.floor(bitLength/4294967296),low=bitLength>>>0;
  for(let i=3;i>=0;i--)bytes.push((high>>>(8*i))&255);for(let i=3;i>=0;i--)bytes.push((low>>>(8*i))&255);
  const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotate=(x:number,n:number):number=>(x>>>n)|(x<<(32-n));
  for(let offset=0;offset<bytes.length;offset+=64){const w:number[]=[];for(let i=0;i<16;i++)w.push((bytes[offset+4*i]<<24)|(bytes[offset+4*i+1]<<16)|(bytes[offset+4*i+2]<<8)|bytes[offset+4*i+3]);for(let i=16;i<64;i++){const s0=rotate(w[i-15],7)^rotate(w[i-15],18)^(w[i-15]>>>3),s1=rotate(w[i-2],17)^rotate(w[i-2],19)^(w[i-2]>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)|0;}let [a,b,c,d,e,f,g,z]=h;for(let i=0;i<64;i++){const s1=rotate(e,6)^rotate(e,11)^rotate(e,25),ch=(e&f)^(~e&g),t1=(z+s1+ch+k[i]+w[i])|0,s0=rotate(a,2)^rotate(a,13)^rotate(a,22),maj=(a&b)^(a&c)^(b&c),t2=(s0+maj)|0;z=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}[a,b,c,d,e,f,g,z].forEach((v,i)=>{h[i]=(h[i]+v)|0;});}
  return h.map(v=>(v>>>0).toString(16).padStart(8,'0')).join('');
}
function machineHeaders(spec: Spec): string[] {return spec.headers.filter(h=>spec.human.indexOf(h)<0&&spec.calculated.indexOf(h)<0);}
function rowDigest(row: RowImage | RowChange): string {return sha256(canonical({values:row.values,links:row.links}));}
function groupRows(changes: Changes, group: string): RowChange[] {return group==='actions'?changes.actions:group==='instances'?changes.instances:group==='emails'?changes.emails:changes.dailyRows;}
function getCount(counts: Counts, group: string): number {return group==='actions'?counts.actions:group==='instances'?counts.instances:group==='emails'?counts.emails:counts.dailyRows;}
function tableCounts(images: TableImage[]): Counts {return {actions:images[0].rows.length,instances:images[1].rows.length,emails:images[2].rows.length,dailyRows:images[3].rows.length};}
function validateEnvelope(batch: Envelope): void {
  requireCondition(batch!==null&&typeof batch==='object','Invalid envelope');
  requireCondition(same(Object.keys(batch).sort(),['schemaVersion','batchId','workbookKey','payloadSha256','expectedRevision','generatedAt','changes'].sort()),'Unexpected envelope fields');
  requireCondition(batch.schemaVersion===1&&/^[A-Za-z0-9_.:-]{1,160}$/.test(batch.batchId)&&/^[A-Za-z0-9_.:-]{1,160}$/.test(batch.workbookKey),'Invalid schema/batch/workbook key');
  requireCondition(Number.isSafeInteger(batch.expectedRevision)&&batch.expectedRevision>=0&&Number.isFinite(Date.parse(batch.generatedAt)),'Invalid revision/timestamp');
  const digestInput={schemaVersion:batch.schemaVersion,batchId:batch.batchId,workbookKey:batch.workbookKey,expectedRevision:batch.expectedRevision,generatedAt:batch.generatedAt,changes:batch.changes};
  requireCondition(/^[a-f0-9]{64}$/.test(batch.payloadSha256)&&sha256(canonical(digestInput))===batch.payloadSha256,'Payload digest mismatch');
  requireCondition(same(Object.keys(batch.changes).sort(),['actions','instances','emails','dailyRows'].sort()),'Unexpected change groups');
  let count=0;
  SPECS.forEach(spec=>{
    const rows=groupRows(batch.changes,spec.group),seen:string[]=[];requireCondition(Array.isArray(rows),'Missing change array');count+=rows.length;
    rows.forEach(row=>{
      requireCondition(same(Object.keys(row).sort(),['key','expectedMachineSha256','values','links'].sort()),'Unexpected row fields');
      requireCondition(typeof row.key==='string'&&row.key.length>0&&row.key.length<=1024&&seen.indexOf(row.key)<0,'Missing/duplicate input key');seen.push(row.key);
      requireCondition(row.expectedMachineSha256===null||/^[a-f0-9]{64}$/.test(row.expectedMachineSha256),'Invalid prior row digest');
      requireCondition(same(Object.keys(row.values).sort(),machineHeaders(spec).sort()),'Machine column schema mismatch: '+spec.table);
      requireCondition(same(Object.keys(row.links).sort(),spec.linkColumns.slice().sort()),'Link schema mismatch');
      requireCondition(row.values[spec.key]===row.key,'Stable source key mismatch');
      Object.keys(row.values).forEach(key=>{const v=row.values[key];requireCondition(typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v),'Invalid cell value');if(typeof v==='string')requireCondition(v.length<=30000,'Cell text exceeds safe Excel limit');if(typeof v==='number')requireCondition(Number(v.toPrecision(15))===v,'Numeric cell exceeds Excel precision; normalize before hashing');});
      Object.keys(row.links).forEach(key=>requireCondition(row.links[key]===''||/^https:\/\/[^\s]+$/.test(row.links[key]),'Unsupported source URL'));
    });
  });
  requireCondition(count>=0&&count<=MAX_CHANGES,'Batch permits 0–150 changed rows');
}
function planTable(image: TableImage, changes: RowChange[], recovering: boolean): TablePlan {
  const keys:string[]=[],display:string[]=[],human:{[key:string]:Fields}={};
  image.rows.forEach(row=>{requireCondition(keys.indexOf(row.key)<0,'Duplicate workbook source key');keys.push(row.key);const visible=String(row.values[image.spec.displayKey]);requireCondition(visible!==''&&display.indexOf(visible)<0,'Duplicate/blank visible record ID');display.push(visible);human[row.key]=row.human;});
  const updates:PlannedRow[]=changes.map(change=>{
    const row=image.rows.find(r=>r.key===change.key);
    if(row){const current=rowDigest(row),already=current===rowDigest(change);requireCondition(change.expectedMachineSha256===current||recovering&&already,'Machine row conflict: '+image.spec.table+' / '+change.key);requireCondition(change.values[image.spec.displayKey]===row.values[image.spec.displayKey],'Cannot change stable display ID');image.spec.linkColumns.forEach(h=>requireCondition(!row.links[h]||row.links[h]===change.links[h],'Existing source URL replacement/removal requires reviewed migration'));return {change,existed:true,alreadyApplied:already};}
    requireCondition(change.expectedMachineSha256===null,'Missing existing source row: '+change.key);
    const visible=String(change.values[image.spec.displayKey]);requireCondition(visible!==''&&display.indexOf(visible)<0,'Duplicate new display ID');display.push(visible);return {change,existed:false,alreadyApplied:false};
  });
  return {spec:image.spec,updates,existingKeys:keys,human};
}
function validateReferences(images: TableImage[], plans: TablePlan[]): void {
  const actionIds=images[0].rows.map(r=>r.key).concat(plans[0].updates.map(p=>p.change.key));
  plans.slice(1,3).forEach(p=>p.updates.forEach(u=>requireCondition(actionIds.indexOf(String(u.change.values['Action ID']))>=0,'Unknown Action ID')));
  plans[1].updates.filter(u=>!u.existed).forEach(update=>{
    const key=String(update.change.values['Action ID']),action=images[0].rows.find(r=>r.key===key);
    if(action&&action.human['Status']==='Resolved'){
      const change=plans[0].updates.find(u=>u.change.key===key);
      requireCondition(!!change&&String(change.change.values['Observed evidence / limits']).indexOf('Recurrence recorded')>=0,'Resolved action requires explicit machine recurrence evidence');
    }
  });
}
function getTable(workbook: ExcelScript.Workbook, spec: Spec): ExcelScript.Table {
  const table=workbook.getTable(spec.table);requireCondition(!!table,'Missing native table: '+spec.table);
  const sheet=table.getWorksheet();requireCondition(sheet.getName()===spec.sheet,'Table moved to unexpected sheet');
  const header=table.getHeaderRowRange();requireCondition(header.getRowIndex()===spec.row&&header.getColumnIndex()===spec.column,'Table moved: '+spec.table);
  requireCondition(same(header.getValues()[0],spec.headers)&&!table.getShowTotals(),'Unexpected table schema/totals: '+spec.table);
  requireCondition(!sheet.getProtection().getProtected(),'Worksheet protected/locked');return table;
}
function readImage(workbook: ExcelScript.Workbook, spec: Spec, selectedKeys: string[] | null): TableImage {
  const table=getTable(workbook,spec),rows:RowImage[]=[];
  if(table.getRowCount()===0)return {spec,rows};
  const range=table.getRangeBetweenHeaderAndTotal(),values=range.getValues(),formulas=range.getFormulas();
  const formulaCells:{[key:string]:boolean}={},formulaAreas=range.getSpecialCells(ExcelScript.SpecialCellType.formulas);
  if(formulaAreas){
    const originRow=range.getRowIndex(),originColumn=range.getColumnIndex(),areas=formulaAreas.getAreas();
    for(let i=0;i<areas.length;i++){
      const area=areas[i],top=area.getRowIndex()-originRow,left=area.getColumnIndex()-originColumn,height=area.getRowCount(),width=area.getColumnCount();
      // Workbook getters can synchronize with the cloud. Read dimensions once,
      // then enumerate the formula cells entirely in memory.
      for(let r=0;r<height;r++)for(let c=0;c<width;c++)formulaCells[(top+r)+':'+(left+c)]=true;
    }
  }
  values.forEach((cells,index)=>{
    const key=String(cells[spec.headers.indexOf(spec.key)]);requireCondition(key!=='','Blank source key');
    const machine:Fields={},human:Fields={},calculated:Fields={},links:Links={};
    spec.headers.forEach((h,col)=>{if(spec.human.indexOf(h)>=0){requireCondition(!formulaCells[index+':'+col],'Unexpected formula in editable field; manual review required');human[h]=cells[col];}else if(spec.calculated.indexOf(h)>=0)calculated[h]=formulas[index][col];else{requireCondition(!formulaCells[index+':'+col],'Unexpected formula in machine source column');machine[h]=cells[col];}});
    if(selectedKeys===null||selectedKeys.indexOf(key)>=0)spec.linkColumns.forEach(h=>{const link=range.getCell(index,spec.headers.indexOf(h)).getHyperlink();links[h]=link?.address||'';});
    rows.push({key,values:machine,links,human,formulas:calculated});
  });return {spec,rows};
}
function stateCell(workbook: ExcelScript.Workbook): ExcelScript.Range {const s=workbook.getWorksheet('_TrackerSync');requireCondition(!!s,'Reviewed bootstrap required');return s.getRange('B1');}
function readState(workbook: ExcelScript.Workbook): SyncState {const state=JSON.parse(String(stateCell(workbook).getValue())) as SyncState;requireCondition(state.schemaVersion===1&&Number.isSafeInteger(state.revision),'Invalid native sync state');return state;}
function writeState(workbook: ExcelScript.Workbook, state: SyncState): void {stateCell(workbook).setValue(canonical(state));requireCondition(same(readState(workbook),state),'Sync state write verification failed');}
function receiptsTable(workbook: ExcelScript.Workbook): ExcelScript.Table {const t=workbook.getTable('TrackerSyncReceipts');requireCondition(!!t&&t.getWorksheet().getName()==='_TrackerSync'&&same(t.getHeaderRowRange().getValues()[0],RECEIPT_HEADERS),'Invalid receipt table');return t;}
function findReceipt(workbook: ExcelScript.Workbook,batch:Envelope): Receipt | undefined {
  const table=receiptsTable(workbook);if(!table.getRowCount())return undefined;
  const rows=table.getRangeBetweenHeaderAndTotal().getValues(),matching=rows.filter(r=>r[0]===batch.batchId);requireCondition(matching.length<=1,'Duplicate batch receipt');
  if(!matching.length)return undefined;requireCondition(matching[0][1]===batch.payloadSha256,'Batch ID reused with different payload');
  const receipt=JSON.parse(String(matching[0][3])) as Receipt;requireCondition(receipt.verified&&receipt.batchId===batch.batchId&&receipt.payloadSha256===batch.payloadSha256&&receipt.workbookKey===batch.workbookKey,'Invalid stored receipt');return receipt;
}
// Excel also coerces ISO dates, numeric-looking IDs and leading apostrophes.
// Prefix every nonempty source string once. Native getValues() removes that
// escape while preserving the original text, including any original apostrophe.
function safeLiteral(value: Cell): Cell {return typeof value==='string'&&value!==''?"'"+value:value;}
function currentRowIndex(table: ExcelScript.Table,spec:Spec,key:string): number {
  // Re-read the live key column for every write so a sort still follows the
  // source identity. No cached row index or full-table value read is needed.
  const keys=table.getColumnByName(spec.key).getRangeBetweenHeaderAndTotal().getValues(),matches:number[]=[];
  keys.forEach((row,i)=>{if(row[0]===key)matches.push(i);});requireCondition(matches.length===1,'Source row moved/deleted/duplicated during write');return matches[0];
}
function liveRowBeforeWrite(table: ExcelScript.Table,spec:Spec,index:number,key:string):RowImage {
  const range=table.getRangeBetweenHeaderAndTotal().getRow(index),cells=range.getValues()[0];
  requireCondition(cells[spec.headers.indexOf(spec.key)]===key,'Source row moved during write');
  const formulaAreas=range.getSpecialCells(ExcelScript.SpecialCellType.formulas);
  if(formulaAreas){
    const left=range.getColumnIndex(),areas=formulaAreas.getAreas();
    for(let i=0;i<areas.length;i++){
      const start=areas[i].getColumnIndex()-left,width=areas[i].getColumnCount();
      for(let col=start;col<start+width;col++)requireCondition(spec.calculated.indexOf(spec.headers[col])>=0,'Unexpected formula appeared before write');
    }
  }
  const values:Fields={},human:Fields={},links:Links={};
  spec.headers.forEach((header,col)=>{if(spec.human.indexOf(header)>=0)human[header]=cells[col];else if(spec.calculated.indexOf(header)<0)values[header]=cells[col];});
  spec.linkColumns.forEach(header=>{const link=range.getCell(0,spec.headers.indexOf(header)).getHyperlink();links[header]=link?.address||'';});
  return {key,values,links,human,formulas:{}};
}
function writeRow(workbook: ExcelScript.Workbook, plan: TablePlan, update: PlannedRow): void {
  const table=getTable(workbook,plan.spec),spec=plan.spec,row=update.change;
  let priorLinks:Links={};
  if(update.alreadyApplied)return;
  if(!update.existed){const cells=spec.headers.map(h=>spec.human.indexOf(h)>=0?(h==='Status'?'Not started':''):spec.calculated.indexOf(h)>=0?'':safeLiteral(row.values[h]));table.addRows(-1,[cells]);}
  const index=currentRowIndex(table,spec,row.key),range=table.getRangeBetweenHeaderAndTotal();
  // Target only machine-owned cells. Never set an existing entire row.
  if(update.existed){
    const live=liveRowBeforeWrite(table,spec,index,row.key);
    requireCondition(rowDigest(live)===row.expectedMachineSha256,'Machine row changed before write');
    requireCondition(same(live.human,plan.human[row.key]),'Human fields changed before write');
    spec.linkColumns.forEach(h=>requireCondition(!live.links[h]||live.links[h]===row.links[h],'Existing source URL replacement/removal requires reviewed migration'));priorLinks=live.links;
    // Contiguous machine bands keep API calls bounded without touching input columns.
    let start=-1,band:Cell[]=[];
    for(let col=0;col<=spec.headers.length;col++){
      const h=spec.headers[col],owned=col<spec.headers.length&&spec.human.indexOf(h)<0&&spec.calculated.indexOf(h)<0;
      if(owned){if(start<0)start=col;band.push(safeLiteral(row.values[h]));}
      else if(start>=0){range.getCell(index,start).getResizedRange(0,band.length-1).setValues([band]);start=-1;band=[];}
    }
  }
  // Replacing one cell inside a native multi-cell hyperlink makes an overlapping
  // link; clearing that cell can remove the neighbors' links too. Preserve any
  // unchanged URL, and never clear source hyperlinks automatically.
  spec.linkColumns.forEach(h=>{if(row.links[h]&&(!update.existed||priorLinks[h]!==row.links[h]))range.getCell(index,spec.headers.indexOf(h)).setHyperlink({address:row.links[h],textToDisplay:String(row.values[h])});});
}
function calculatedFormula(spec: Spec, header: string): string {
  if(spec.group==='actions')return header==='Records'?'=COUNTIF(IncidentInstances[Action ID],[@[Action ID]])':'=COUNTIF(EmailEvidence[Action ID],[@[Action ID]])';
  return '=IFERROR(INDEX(ActionTracker[Recommended next step],MATCH([@[Action ID]],ActionTracker[Action ID],0)),"Missing action")';
}
function checkManagedFormulas(images: TableImage[], recoveringChanges?: Changes): void {images.forEach(image=>image.rows.forEach(row=>image.spec.calculated.forEach(h=>{
  const newPending=recoveringChanges&&groupRows(recoveringChanges,image.spec.group).some(change=>change.key===row.key&&change.expectedMachineSha256===null);
  requireCondition(row.formulas[h]===calculatedFormula(image.spec,h)||!!newPending&&row.formulas[h]==='','Managed formula changed; review before overwrite');
})));}
function checkSummaryFormulas(workbook:ExcelScript.Workbook):void {
  const sheet=workbook.getWorksheet('Actions');
  requireCondition(sheet.getRange('B5').getFormula()==='=COUNTA(IncidentInstances[Occurrence ID])'&&sheet.getRange('D5').getFormula()==='=COUNTA(EmailEvidence[Outlook message ID])'&&sheet.getRange('F5').getFormula()==='=COUNTIF(ActionTracker[Status],"<>Resolved")','Managed summary formula changed');
}
function refreshFormulas(workbook: ExcelScript.Workbook): void {
  SPECS.forEach(spec=>{const table=getTable(workbook,spec);if(table.getRowCount())spec.calculated.forEach(h=>table.getColumnByName(h).getRangeBetweenHeaderAndTotal().setFormula(calculatedFormula(spec,h)));});
  const actions=workbook.getWorksheet('Actions');actions.getRange('B5').setFormula('=COUNTA(IncidentInstances[Occurrence ID])');actions.getRange('D5').setFormula('=COUNTA(EmailEvidence[Outlook message ID])');actions.getRange('F5').setFormula('=COUNTIF(ActionTracker[Status],"<>Resolved")');
  workbook.getApplication().calculate(ExcelScript.CalculationType.full);
}
function verifyCalculatedValues(workbook:ExcelScript.Workbook,images:TableImage[]):void {
  const sheet=workbook.getWorksheet('Actions'),counts=tableCounts(images);
  requireCondition(sheet.getRange('B5').getValue()===counts.instances&&sheet.getRange('D5').getValue()===counts.emails&&sheet.getRange('F5').getValue()===images[0].rows.filter(row=>row.human.Status!=='Resolved').length,'Recalculated summary totals differ from source counts');
  const actionRows=getTable(workbook,SPECS[0]).getRangeBetweenHeaderAndTotal().getValues();
  actionRows.forEach(cells=>{const key=String(cells[0]);requireCondition(cells[4]===images[1].rows.filter(row=>row.values['Action ID']===key).length&&cells[5]===images[2].rows.filter(row=>row.values['Action ID']===key).length,'Action count formula did not calculate');});
  if(images[1].rows.length)getTable(workbook,SPECS[1]).getRangeBetweenHeaderAndTotal().getValues().forEach(cells=>{const action=images[0].rows.find(row=>row.key===cells[6]);requireCondition(!!action&&cells[8]===action.values['Recommended next step'],'Instance action lookup did not calculate');});
}
function verifyPostread(before: TableImage[], after: TableImage[], plans: TablePlan[]): void {
  plans.forEach((plan,i)=>{
    const rows=after[i].rows,keys=rows.map(r=>r.key);requireCondition(new Set(keys).size===keys.length,'Duplicate key after write');
    requireCondition(rows.length===before[i].rows.length+plan.updates.filter(p=>!p.existed).length,'Unexpected table row count after write');
    plan.existingKeys.forEach(key=>requireCondition(keys.indexOf(key)>=0,'Existing source row disappeared'));
    before[i].rows.forEach(row=>{const current=rows.find(r=>r.key===row.key);requireCondition(!!current,'Existing source row missing');requireCondition(same(current.human,row.human),'Human fields changed during refresh; do not acknowledge');if(!plan.updates.some(u=>u.change.key===row.key))requireCondition(same(current.values,row.values),'Unrelated source row changed during refresh');});
    plan.updates.forEach(update=>{const current=rows.find(r=>r.key===update.change.key);requireCondition(!!current&&rowDigest(current)===rowDigest(update.change),'Postread machine data mismatch');});
  });checkManagedFormulas(after);
}
function main(workbook: ExcelScript.Workbook, payloadJson: string): string {
  requireCondition(payloadJson.length<=1500000,'Payload too large; split before delivery');
  const batch=JSON.parse(payloadJson) as Envelope;validateEnvelope(batch);
  const state=readState(workbook);requireCondition(state.workbookKey===batch.workbookKey&&state.mode==='ready','Wrong workbook or writer paused');
  const prior=findReceipt(workbook,batch);if(prior){
    if(state.revision===prior.revision-1&&state.pendingBatchId===batch.batchId&&state.pendingPayloadSha256===batch.payloadSha256){
      // Receipt was verified and saved, but final state write/response failed.
      const current=SPECS.map(spec=>readImage(workbook,spec,groupRows(batch.changes,spec.group).map(r=>r.key)));
      requireCondition(same(tableCounts(current),prior.counts),'Count conflict while recovering receipt');
      current.forEach(image=>groupRows(batch.changes,image.spec.group).forEach(change=>{const row=image.rows.find(r=>r.key===change.key);requireCondition(!!row&&rowDigest(row)===rowDigest(change),'Readback conflict while recovering receipt');}));
      checkManagedFormulas(current);writeState(workbook,{...state,revision:prior.revision,pendingBatchId:'',pendingPayloadSha256:'',pendingExpectedRevision:-1,initialCounts:prior.counts});
    }else requireCondition(state.revision>=prior.revision,'Receipt/state revision inconsistency');
    return canonical(prior);
  }
  requireCondition(state.revision===batch.expectedRevision,'Stale writer revision');
  const recovering=state.pendingBatchId===batch.batchId&&state.pendingPayloadSha256===batch.payloadSha256;
  requireCondition(state.pendingBatchId===''||recovering,'Another batch requires recovery');
  const images=SPECS.map(spec=>readImage(workbook,spec,groupRows(batch.changes,spec.group).map(r=>r.key)));
  // Only a newly appended pending row may still have blank calculated cells.
  checkManagedFormulas(images,recovering?batch.changes:undefined);checkSummaryFormulas(workbook);
  const plans=images.map(image=>planTable(image,groupRows(batch.changes,image.spec.group),recovering));validateReferences(images,plans);
  const receiptSizeEstimate=canonical({schemaVersion:1,batchId:batch.batchId,workbookKey:batch.workbookKey,payloadSha256:batch.payloadSha256,verified:true,revision:batch.expectedRevision+1,applied:{actions:batch.changes.actions.map(r=>r.key),instances:batch.changes.instances.map(r=>r.key),emails:batch.changes.emails.map(r=>r.key),dailyRows:batch.changes.dailyRows.map(r=>r.key)},counts:tableCounts(images)}).length;
  requireCondition(receiptSizeEstimate<29000,'Receipt exceeds safe cell size; split this batch');
  const counts=tableCounts(images);SPECS.forEach(s=>requireCondition(getCount(counts,s.group)>=getCount(state.initialCounts,s.group),'Historical rows missing before refresh'));
  const pending:SyncState={...state,pendingBatchId:batch.batchId,pendingPayloadSha256:batch.payloadSha256,pendingExpectedRevision:batch.expectedRevision,initialCounts:recovering?state.initialCounts:counts};
  writeState(workbook,pending);
  // Failures leave this marker. Only the identical frozen batch can resume.
  plans.forEach(plan=>plan.updates.forEach(update=>writeRow(workbook,plan,update)));
  refreshFormulas(workbook);
  const after=SPECS.map(spec=>readImage(workbook,spec,groupRows(batch.changes,spec.group).map(r=>r.key)));verifyPostread(images,after,plans);verifyCalculatedValues(workbook,after);
  const keys:SourceKeys={actions:batch.changes.actions.map(r=>r.key),instances:batch.changes.instances.map(r=>r.key),emails:batch.changes.emails.map(r=>r.key),dailyRows:batch.changes.dailyRows.map(r=>r.key)};
  const receipt:Receipt={schemaVersion:1,batchId:batch.batchId,workbookKey:batch.workbookKey,payloadSha256:batch.payloadSha256,verified:true,revision:batch.expectedRevision+1,applied:keys,counts:tableCounts(after)};
  // Persist verified receipt before final revision so a timed-out finalization can
  // re-read the exact data and finish without applying the batch twice.
  const receipts=receiptsTable(workbook);receipts.addRows(-1,[[safeLiteral(batch.batchId),safeLiteral(batch.payloadSha256),receipt.revision,safeLiteral(canonical(receipt))]]);
  requireCondition(same(findReceipt(workbook,batch),receipt),'Receipt postread verification failed');
  writeState(workbook,{...pending,revision:receipt.revision,pendingBatchId:'',pendingPayloadSha256:'',pendingExpectedRevision:-1,initialCounts:receipt.counts});
  if(receipts.getRowCount()>MAX_RECEIPTS)receipts.deleteRowsAt(0,receipts.getRowCount()-MAX_RECEIPTS);
  return canonical(receipt);
}
