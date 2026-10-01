/** Bundle with office-script.ts shared helpers using build-office-scripts.cjs.
 * Candidate only. Run inspect first, review output, then supply that exact digest
 * and footer values for a separately authorized initialization. It starts paused.
 */
interface BootstrapRequest { mode: string; workbookKey: string; expectedSourceSha256: string; footerAddress: string; expectedFooter: Cell[][]; dailyRows: Cell[][] }
function bootstrapSource(workbook: ExcelScript.Workbook): TableImage[] {
  // null requests all source links from the same validated table read. Avoid
  // reading every value and validating the same table twice merely to get keys.
  return SPECS.slice(0,3).map(spec=>readImage(workbook,spec,null));
}
function bootstrapDigest(images: TableImage[]): string {
  return sha256(canonical(images.map(image=>({table:image.spec.table,rows:image.rows.slice().sort((a,b)=>a.key.localeCompare(b.key))}))));
}
function main(workbook: ExcelScript.Workbook, bootstrapJson: string): string {
  const input=JSON.parse(bootstrapJson) as BootstrapRequest;
  requireCondition(input.mode==='inspect'||input.mode==='initialize','Invalid bootstrap mode');
  requireCondition(/^[A-Za-z0-9_.:-]{1,160}$/.test(input.workbookKey),'Invalid workbook key');
  requireCondition(!workbook.getWorksheet('_TrackerSync')&&!workbook.getTable('DailyDeliveries')&&!workbook.getTable('TrackerSyncReceipts'),'Already initialized or partially initialized; review before retry');
  requireCondition(same(workbook.getWorksheets().map(s=>s.getName()),['Actions','Instances','Emails']),'Unexpected worksheet structure');
  const images=bootstrapSource(workbook),sourceSha256=bootstrapDigest(images);
  images.forEach(image=>planTable(image,[],false)); // rejects duplicate keys/display IDs
  const sheet=workbook.getWorksheet('Instances');
  requireCondition(/^A[0-9]+:X[0-9]+$/.test(input.footerAddress),'Footer must be an exact reviewed A:X region');
  const footer=sheet.getRange(input.footerAddress),footerValues=footer.getValues();
  requireCondition(!footer.getSpecialCells(ExcelScript.SpecialCellType.formulas),'Footer contains formulas; preserve through manual migration');
  const oldTable=getTable(workbook,SPECS[1]);requireCondition(footer.getRowIndex()>oldTable.getRange().getRowIndex()+oldTable.getRange().getRowCount()-1,'Footer overlaps source table');
  if(input.mode==='inspect')return canonical({sourceSha256,counts:{actions:images[0].rows.length,instances:images[1].rows.length,emails:images[2].rows.length},footerAddress:input.footerAddress,footerValues,seed:images.map(image=>({group:image.spec.group,rows:image.rows.map(row=>({key:row.key,values:row.values,links:row.links,machineSha256:rowDigest(row)}))})),groupingMapVerified:false});
  requireCondition(input.expectedSourceSha256===sourceSha256&&same(input.expectedFooter,footerValues),'Workbook changed since reviewed bootstrap snapshot');
  const daily=input.dailyRows;requireCondition(Array.isArray(daily)&&daily.every(row=>row.length===5),'Invalid daily history shape');
  const ids=daily.map(row=>String(row[4]));requireCondition(ids.every(id=>id!=='')&&new Set(ids).size===ids.length,'Missing/duplicate daily job ID');
  // Every supplied daily row must be an exact row in the footer, and every footer
  // row with a Job reference must be supplied. No history is inferred or dropped.
  const headerIndex=footerValues.findIndex(row=>same(row.slice(0,5),DAILY_HEADERS));requireCondition(headerIndex>=0,'Daily header missing from reviewed footer');
  const extracted:Cell[][]=[];for(let i=headerIndex+1;i<footerValues.length;i++){const row=footerValues[i];if(row[4]==='')break;extracted.push(row.slice(0,5));}
  requireCondition(same(extracted,daily),'Daily history does not match source footer');
  const target=sheet.getRangeByIndexes(4,25,Math.max(2,daily.length+1),5);
  requireCondition(target.getValues().every(row=>row.every(v=>v==='')),'Daily target contains existing content');
  // Freeze approved source fingerprints in hidden state only after all preflight.
  target.getCell(0,0).getResizedRange(0,4).setValues([DAILY_HEADERS]);
  const dailyTable=sheet.addTable(target.getCell(0,0).getResizedRange(daily.length,4),true);dailyTable.setName('DailyDeliveries');
  if(daily.length)dailyTable.getRangeBetweenHeaderAndTotal().setValues(daily.map(row=>row.map(value=>safeLiteral(value))));
  requireCondition(same(dailyTable.getRangeBetweenHeaderAndTotal().getValues(),daily),'Daily copy verification failed; old footer retained');
  // Preserve non-daily footer context at AG:BD before clearing the old footprint.
  const archive=sheet.getRangeByIndexes(4,32,footerValues.length,24);
  requireCondition(archive.getValues().every(row=>row.every(v=>v==='')),'Footer archive target occupied; old footer retained');
  archive.setValues(footerValues.map(row=>row.map(value=>safeLiteral(value))));requireCondition(same(archive.getValues(),footerValues),'Footer archive verification failed; original retained');
  requireCondition(bootstrapDigest(bootstrapSource(workbook))===sourceSha256,'Source changed during bootstrap; old footer retained');
  requireCondition(same(footer.getValues(),footerValues),'Footer changed during bootstrap; original retained');
  footer.clear(ExcelScript.ClearApplyTo.contents);
  const sync=workbook.addWorksheet('_TrackerSync');sync.getRange('A1').setValue('PoseTek sync state');
  const counts:Counts={actions:images[0].rows.length,instances:images[1].rows.length,emails:images[2].rows.length,dailyRows:daily.length};
  const state:SyncState={schemaVersion:1,workbookKey:input.workbookKey,revision:0,mode:'paused',pendingBatchId:'',pendingPayloadSha256:'',pendingExpectedRevision:-1,initialCounts:counts};
  sync.getRange('B1').setValue(canonical(state));sync.getRange('A3:D3').setValues([RECEIPT_HEADERS]);
  const receipts=sync.addTable('A3:D3',true);receipts.setName('TrackerSyncReceipts');sync.setVisibility(ExcelScript.SheetVisibility.hidden);
  refreshFormulas(workbook);
  requireCondition(same(readState(workbook),state),'Bootstrap state postread failed');
  const seeded=SPECS.map(spec=>readImage(workbook,spec,null));
  checkManagedFormulas(seeded);
  return canonical({initialized:true,mode:'paused',workbookKey:input.workbookKey,revision:0,sourceSha256,counts,seed:seeded.map(image=>({group:image.spec.group,rows:image.rows.map(row=>({key:row.key,values:row.values,links:row.links,machineSha256:rowDigest(row)}))}))});
}
