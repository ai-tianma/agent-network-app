import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
mkdirSync('/output', {recursive:true});
let mode = 'ok', saved = {a:null,b:null}, writes=0, release;
const server=createServer(async (req,res)=>{
 const path=new URL(req.url,'http://fixture').pathname;
 if(path==='/missing-avatar.png') return res.writeHead(404).end();
 if (path.startsWith('/api/')) {
  const account=req.headers.authorization==='Bearer dummy-b'?'b':'a';
  res.setHeader('Content-Type','application/json');
  if (path==='/api/auth/me' && req.method==='GET') return res.end(JSON.stringify({user:{user_id:account,username:'same-name',...(mode==='old'?{}:{avatar_url:saved[account]})}}));
  if (path==='/api/auth/me/avatar' && req.method==='PUT') {
   writes++; let body=''; for await(const chunk of req) body+=chunk;
   if(mode==='fail') return res.writeHead(500).end('{"ok":false}');
   if(mode==='delay') await new Promise(r=>{release=r;});
   saved[account]=JSON.parse(body).avatar_url;
   return res.end(JSON.stringify({ok:true,user_id:account,avatar_url:saved[account]}));
  }
  return res.writeHead(404).end('{}');
 }
 res.setHeader('Content-Type',path==='/app.js'?'text/javascript':'text/html');
 res.end(path==='/app.js'?readFileSync('/app/user-avatar.js'):'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
let count=0;const check=(name,ok)=>{assert(ok,name);count++;console.log('PASS',name);};
// RN Web Image renders a nested CSS background, not a src on its testID View.
// A null === null comparison on the wrapper is not an image assertion.
async function imageValue(page,id) {
 const value=await page.getByTestId(id).locator('[style*="background-image"]').first().evaluate(e=>e.style.backgroundImage);
 assert(value && value.startsWith('url('),'actual nonempty rendered image required');
 return value;
}
try {
 for(const [width,theme] of [[390,'light'],[1280,'dark']]) {
  mode='ok';saved={a:null,b:null};writes=0;
  const page=await browser.newPage({viewport:{width,height:1000}});
  await page.goto(`http://127.0.0.1:${server.address().port}?theme=${theme}`);
  await page.getByTestId('user-avatar-pick-3').waitFor();
  check(`${theme}: theme colors and neutral secondary actions`, await page.evaluate(() => {
   const style = id => getComputedStyle(document.querySelector(`[data-testid="${id}"]`));
   const rgb = hex => `rgb(${hex.slice(1).match(/../g).map(v=>parseInt(v,16)).join(', ')})`;
   const c = window.avatarTheme;
   // #924: the hint is body text on a card, so it must use the body token and
   // actually clear a readable contrast — pin the READABILITY, not the token
   // name (the token name was the thing that regressed silently in dark mode).
   const lum = hex => { const [r,g,b] = hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255)
     .map(v => v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4)); return 0.2126*r+0.7152*g+0.0722*b; };
   const ratio = (a,b) => { const [hi,lo] = [lum(a),lum(b)].sort((x,y)=>y-x); return (hi+0.05)/(lo+0.05); };
   return style('user-avatar-hint').color === rgb(c.text)
    && style('user-avatar-hint').color !== rgb(c.textSecondary)
    && ratio(c.text, c.card) >= 7
    && style('user-avatar-url').backgroundColor === rgb(c.inputBg)
    && style('user-avatar-url').borderTopColor === rgb(c.border)
    && style('user-avatar-reset').backgroundColor === rgb(c.groupedRow)
    && style('user-avatar-save').backgroundColor === rgb(c.groupedRow);
  }));
  await page.getByTestId('user-avatar-url').fill('https://example.test/avatar.png');
  check(`${theme}: only available save uses primary color`, await page.getByTestId('user-avatar-save').evaluate(e => {
   const c = window.avatarTheme.accent;
   return getComputedStyle(e).backgroundColor === `rgb(${c.slice(1).match(/../g).map(v=>parseInt(v,16)).join(', ')})`;
  }));
  await page.getByTestId('user-avatar-url').fill('');
  await page.getByTestId('user-avatar-pick-3').click();
  await page.getByTestId('user-avatar-message').filter({hasText:'已保存到 Hub'}).waitFor();
  check(`${width}: pool persisted`,saved.a==='/avatars/avatar-03.webp');
  const image=await imageValue(page,'user-avatar-preview');
  const expected=await imageValue(page,process.env.TEST_AVATAR_WRONG_IMAGE_EXPECTATION==='1'?'user-avatar-pick-4':'user-avatar-pick-3');
  check(`${width}: selected pool image actually rendered`,image===expected);
  await page.reload();await page.getByTestId('user-avatar-pick-3').waitFor();
  check(`${width}: reload reads Hub avatar`,image===await imageValue(page,'user-avatar-preview'));
  await page.screenshot({path:`/output/avatar-${width}.png`,fullPage:true});
  mode='fail';await page.getByTestId('user-avatar-pick-4').click();
  await page.getByTestId('user-avatar-message').filter({hasText:'无法确认'}).waitFor();
  check(`${width}: failure preserves preview`,image===await imageValue(page,'user-avatar-preview'));
  const before=writes;await page.getByTestId('user-avatar-url').fill('file:///private/photo');await page.getByTestId('user-avatar-save').click();
  await page.getByTestId('user-avatar-message').filter({hasText:'有效'}).waitFor();check(`${width}: invalid URL never sent`,writes===before);
  mode='ok';await page.getByTestId('user-avatar-reset').click();await page.getByTestId('user-avatar-message').filter({hasText:'已保存'}).waitFor();
  check(`${width}: reset persisted`,saved.a===null);
  mode='delay';await page.getByTestId('user-avatar-pick-5').click();
  await page.getByText('正在保存…',{exact:true}).waitFor();await page.locator('#switch').click();
  await page.getByTestId('user-avatar-pick-1').waitFor();
  const bImage=await imageValue(page,'user-avatar-preview');
  assert(release);const settled=page.waitForResponse(r=>r.url().endsWith('/api/auth/me/avatar'));release();mode='ok';
  await settled;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  check(`${width}: late response cannot overwrite switched account`,saved.b===null && bImage===await imageValue(page,'user-avatar-preview') && await page.getByTestId('user-avatar-message').count()===0);
  check(`${width}: no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  mode='old';await page.reload();await page.getByTestId('user-avatar-message').filter({hasText:'尚不支持'}).waitFor();
  check(`${width}: old Hub cannot edit`,await page.getByTestId('user-avatar-pick-1').count()===0);
  const display=page.getByTestId('human-display-image');
  await display.waitFor();
  const original=await imageValue(page,'human-display-image');
  await page.evaluate(()=>window.changeNodeAvatar());
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  check(`${width}: same-name node override cannot change human`,original===await imageValue(page,'human-display-image'));
  await page.evaluate(()=>window.showHuman({user_id:'a',username:'same-name',avatar_url:'/avatars/avatar-04.webp'},'https://hub-b.test'));
  await page.waitForFunction(old=>{const v=document.querySelector('[data-testid="human-display-image"] [style*="background-image"]')?.style.backgroundImage;return v && v!==old;},original);
  check(`${width}: new Hub value replaces previous image`,original!==await imageValue(page,'human-display-image'));
  await page.evaluate(()=>window.showHuman({user_id:'b',username:'same-name',avatar_url:location.origin+'/missing-avatar.png'},'https://hub-b.test'));
  await display.waitFor({state:'detached'});
  check(`${width}: failed human image keeps text fallback`,(await page.getByTestId('human-display').textContent()).includes('S'));
  await page.evaluate(()=>window.showHuman({user_id:'b',username:'same-name',avatar_url:'/avatars/avatar-03.webp'},'https://hub-b.test'));
  await display.waitFor();
  check(`${width}: new avatar retries after prior image error`,original===await imageValue(page,'human-display-image'));
  await page.close();
 }
 console.log(`${count}/${count} passed`);
} finally {release?.();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
