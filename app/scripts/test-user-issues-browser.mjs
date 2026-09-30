import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const origin=process.env.ISSUE_PREVIEW_ORIGIN || 'http://127.0.0.1:5184';
assert.ok(new URL(origin).hostname==='127.0.0.1','This synthetic test uses only a local preview.');
const out=new URL('../../.netlify/user-issues/browser/',import.meta.url);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const checks=[];
try {
  for(const width of [360,390,768,1440]) {
    const context=await browser.newContext({viewport:{width,height:900}});
    let submitted=0;
    // No reports or emails reach production during visual tests.
    await context.route('https://us-central1-kickai-69dd0.cloudfunctions.net/submitUserIssue',async route=>{
      if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'content-type,authorization','Access-Control-Allow-Methods':'POST'}});
      submitted++; await route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:JSON.stringify({result:{status:'received',reference:'synthetic-reference'}})});
    });
    const page=await context.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/support#report-problem');
    await page.getByRole('heading',{name:'Report a problem',exact:true}).waitFor();
    await page.getByLabel('What went wrong?').fill('Synthetic check: workout progress could not be saved.');
    await context.setOffline(true);
    await page.getByRole('button',{name:'Send report',exact:true}).click();
    await page.getByText('Saved on this device — waiting to send.',{exact:false}).waitFor();
    assert.equal(submitted,0);
    await context.setOffline(false);
    await page.getByRole('button',{name:'Retry queued reports'}).click();
    await page.getByText('Received — thank you.',{exact:false}).waitFor();
    assert.equal(submitted,1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:fileURLToPath(new URL(`support-${width}.png`,out)),fullPage:true});
    await page.goto(origin+'/admin/user-issues?preview=1');
    await page.getByRole('heading',{name:'User issues',exact:true}).waitFor();
    await page.getByRole('button',{name:/Action failed: Save workout/}).click();
    await page.getByRole('heading',{name:'Reported incidents'}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:fileURLToPath(new URL(`admin-${width}.png`,out)),fullPage:true});
    assert.deepEqual(errors,[]);
    checks.push({width,offlineQueued:true,receivedOnce:true,adminDetail:true,noOverflow:true,noRuntimeErrors:true});
    await context.close();
  }
  await writeFile(new URL('checks.json',out),JSON.stringify(checks,null,2));
  console.log(JSON.stringify(checks));
} finally {await browser.close();}
