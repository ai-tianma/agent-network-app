import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { serveExport, initScript, findChromium, TEST_LOCALE } from '../test-layout-sweep/harness.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const web=await serveExport(process.env.WEB_DIR),browser=await chromium.launch({headless:true,executablePath:findChromium()});
const baseline=process.env.BASELINE==='1',metrics=[];let passed=0;
function fixture(){
  const now='2026-10-12T12:00:00Z';
  window.__tasksFixture={hasMore:false,projects:[],people:[],capabilities:['description','checklist','projects','requirement_seq','list_summary'],requirements:Array.from({length:495},(_,i)=>({id:`r${String(i+1).padStart(4,'0')}`,seq:i+1,name:`Task ${String(i+1).padStart(4,'0')}`,description:'Synthetic performance fixture, no credentials. '.repeat(6),checklist:[],column:'pool',priority:'normal',assignee:'',owner:null,agent_owner:null,participants:[],tags:[],project_id:null,createdAt:now,updatedAt:now}))};
}
try{
  for(const device of [{name:'desktop',viewport:{width:1200,height:850}},{name:'phone',viewport:{width:390,height:844},userAgent:'Android TEST-ONLY',isMobile:true,hasTouch:true}]){
    const {name:deviceName,...options}=device;
    const ctx=await browser.newContext({locale:TEST_LOCALE,...options}),page=await ctx.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.addInitScript({content:`(${initScript.toString().replace('http://mock-hub.invalid','http://127.0.0.1:9200')})({theme:'light'});`});
    await page.addInitScript(fixture);await page.goto(`${web.url}?safeAreaSim=0,0,0,0`);
    await page.waitForFunction(()=>!!window.__anetLayoutSweep);
    await page.evaluate(()=>window.__anetLayoutSweep.setScreen({name:'tasks'}));
    await page.getByTestId('tasks-view-list').waitFor();
    const start=await page.evaluate(()=>performance.now());
    await page.getByTestId('tasks-view-list').click();
    await page.waitForFunction(expected=>document.querySelectorAll('[data-testid^="req-row-r"]').length===expected,baseline?495:50);
    const elapsed=await page.evaluate(async start=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start;},start);
    const mounted=await page.locator('[data-testid^="req-row-r"]').count();
    metrics.push({device:device.name,phase:baseline?'baseline':'paged',fixtureRows:495,mountedRows:mounted,listTransitionMs:Math.round(elapsed)});
    assert.equal(mounted,baseline?495:50);passed++;
    if(!baseline){
      assert((await page.getByTestId('task-page-range').innerText()).includes('495'));passed++;
      await page.getByTestId('task-page-next').click();
      await page.waitForFunction(()=>document.querySelector('[data-testid="task-page-range"]')?.textContent.includes('51–100'));
      assert.equal(await page.locator('[data-testid^="req-row-r"]').count(),50);passed++;
      if(device.name==='desktop'){
        await page.getByTestId('req-sort-title').click();
        await page.waitForFunction(()=>document.querySelector('[data-testid="task-page-range"]')?.textContent.includes('1–50'));passed++;
        await page.getByTestId('task-page-next').click();
        const editId=await page.locator('[data-testid^="req-row-r"]').first().getAttribute('data-testid');
        const cell=page.getByTestId(`task-cell-${editId.slice('req-row-'.length)}-title`);
        await cell.click();await cell.click();
        const draft=page.getByTestId('list-edit-title-input');
        const changed=(await draft.inputValue())+' edited';
        await draft.fill(changed);await draft.press('Enter');
        await page.waitForFunction(name=>(window.__tasksPatches??[]).some(p=>p.name===name),changed);passed++;
      }
      await page.getByTestId('task-page-previous').click();
      await page.waitForFunction(()=>document.querySelector('[data-testid="task-page-range"]')?.textContent.includes('1–50'));passed++;
      for(let i=0;i<9;i++)await page.getByTestId('task-page-next').click();
      await page.waitForFunction(()=>document.querySelectorAll('[data-testid^="req-row-r"]').length===45);passed++;
      assert.equal(await page.getByTestId('task-page-next').getAttribute('aria-disabled'),'true');passed++;
      if(device.name==='desktop'){
        await page.getByTestId('task-search-input').fill('Task 0495');
        await page.waitForFunction(()=>document.querySelectorAll('[data-testid^="req-row-r"]').length===1);
        assert((await page.getByTestId('task-page-range').innerText()).includes('1–1'));passed++;
        assert.equal(await page.getByTestId('req-row-r0495').count(),1);passed++;
        await page.getByTestId('task-search-input').fill('');
        await page.waitForFunction(()=>document.querySelectorAll('[data-testid^="req-row-r"]').length===50 && document.querySelector('[data-testid="task-page-range"]')?.textContent.includes('1–50'));passed++;
      }
      const id=await page.locator('[data-testid^="req-row-r"]').first().getAttribute('data-testid');
      const row=page.getByTestId(id),name=await row.getAttribute('aria-label');
      if(device.name==='desktop'){await row.hover();await page.getByTestId(`req-row-open-${id.slice('req-row-'.length)}`).click();}
      else await row.click();
      await page.getByTestId('req-edit-name').waitFor();
      assert.equal(await page.getByTestId('req-edit-name').inputValue(),name);passed++;
      await page.screenshot({path:`/output/${device.name}-last-page-detail.png`,fullPage:true});
    }
    assert.deepEqual(errors,[]);passed++;
    await ctx.close();
  }
  mkdirSync('/output',{recursive:true});writeFileSync('/output/metrics.json',JSON.stringify({baseline,metrics,passed},null,2));
  console.log(JSON.stringify({baseline,metrics,passed}));console.log(`task pagination actual exported UI: ${passed}/${passed} checks passed`);
}finally{await browser.close();web.close();}
