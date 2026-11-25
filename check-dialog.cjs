const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({channel:'chrome',headless:true});
 for (const width of [1280,390,320]) {
  const page = await browser.newPage({viewport:{width,height:844}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*', async route=>{
   const u=new URL(route.request().url());
   if(u.pathname==='/api/board') return route.fulfill({json:{posts:[{id:'q1',stage:'g1-s2',kind:'question',body:'샘플 분석 질문입니다',nick:'점검',createdAt:'2026-11-16T00:00:00Z'}],replies:[{id:'r1',post:'q1',body:'답변 내용입니다',nick:'점검',createdAt:'2026-11-16T00:10:00Z'}],statuses:{}}});
   if(u.pathname==='/api/analysis-progress') return route.fulfill({json:{done:25,total:100,percent:25,checkedAt:new Date().toISOString()}});
   const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}[u.pathname];
   if(file && u.host==='test.local') return route.fulfill({body:fs.readFileSync('public/'+file),contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html'});
   return route.abort();
  });
  await page.goto('http://test.local');
  await page.locator('#stage-analysis-label').filter({hasText:'25%'}).waitFor();
  assert.equal(await page.locator('#stage-dialog').isVisible(),false);
  const stage=page.getByRole('button',{name:/샘플 분석 · 현재/});
  await stage.click({position:{x:20,y:15}});
  assert.equal(await page.locator('#stage-dialog').isVisible(),true);
  assert.equal(await page.locator('#posts .post').count(),1);
  assert.match(await page.locator('#posts').innerText(),/답변 내용/);
  await page.locator('#kind-seg [data-kind="note"]').click();
  assert.equal(await page.locator('#posts .post').count(),0);
  await page.locator('#kind-seg [data-kind="all"]').click();
  await page.locator('#compose-toggle').click();
  assert.equal(await page.locator('#composer').isVisible(),true);
  await page.locator('#dialog-close').click();
  assert.equal(await page.locator('#stage-dialog').isVisible(),false);
  await stage.click({position:{x:20,y:15}});
  if(width<760){const box=await page.locator('#stage-dialog').boundingBox();assert.equal(Math.round(box.width),width);}
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#stage-dialog').isVisible(),false);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  assert.equal(overflow,false);
  const popupPromise=page.waitForEvent('popup');
  await page.locator('.stage-progress').click();
  const popup=await popupPromise; assert.match(popup.url(),/trycloudflare|about:blank/); await popup.close();
  assert.deepEqual(errors,[]);
  console.log(width+': popup, replies, filters, composer, close, external link, overflow OK');
  await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});

