import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE=process.env.BASE_URL||'http://127.0.0.1:4173';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const calls=[];
const senseDelay=new Map();

function analysisFor(word){
  return {word,wordFrequencyLabel:'中频',wordLevelNotesZh:`${word} 的测试词义说明`,senses:[
    {id:'s1',rank:1,pos:'noun',frequencyLabel:'核心义',zhDefinition:`核心中文-${word}`,zhExplanation:`核心解释-${word}`,register:'通用',domain:'测试',headwords:{en:{primary:word,alternatives:[]},de:{primary:`de-${word}`,alternatives:[]},fr:{primary:`fr-${word}`,alternatives:[]}},typicalContextsZh:[`核心情境-${word}`]},
    {id:'s2',rank:2,pos:'verb',frequencyLabel:'常用义',zhDefinition:`第二义-${word}`,zhExplanation:`第二义解释-${word}`,register:'通用',domain:'测试',headwords:{en:{primary:`${word}-sense2`,alternatives:[]},de:{primary:`de2-${word}`,alternatives:[]},fr:{primary:`fr2-${word}`,alternatives:[]}},typicalContextsZh:[`第二情境-${word}`]}
  ]};
}
function packFor(word,sid){
  return {word,senseId:sid,concept:{zh:`${sid}-中文-${word}`},headwords:{en:{word:sid==='s1'?word:`${word}-sense2`,grammar:'test'},de:{word:sid==='s1'?`de-${word}`:`de2-${word}`,grammar:'test'},fr:{word:sid==='s1'?`fr-${word}`:`fr2-${word}`,grammar:'test'}},forms:{en:[{label:'form',form:`en-form-${sid}`}],de:[{label:'form',form:`de-form-${sid}`}],fr:[{label:'form',form:`fr-form-${sid}`}]},families:[{functionZh:'词族',zh:'中',en:`family-en-${sid}`,de:`family-de-${sid}`,fr:`family-fr-${sid}`}],synonyms:[{nuanceZh:'近义',differenceZh:'差异',zh:'中',en:`syn-en-${sid}`,de:`syn-de-${sid}`,fr:`syn-fr-${sid}`}],antonyms:[{functionZh:'反义',zh:'中',en:`ant-en-${sid}`,de:`ant-de-${sid}`,fr:`ant-fr-${sid}`}],collocations:[{functionZh:'核心搭配',zh:`中搭配-${sid}`,en:`en-col-${sid}`,de:`de-col-${sid}`,fr:`fr-col-${sid}`,confidence:'high',register:'通用'},{functionZh:'扩展搭配',zh:`中扩展-${sid}`,en:`en-med-${sid}`,de:`de-med-${sid}`,fr:`fr-med-${sid}`,confidence:'medium'}],examples:[{scenarioZh:'测试场景',zh:`中文例句-${sid}`,en:`English example ${sid}`,de:`Deutsch Beispiel ${sid}`,fr:`Exemple français ${sid}`}],usageNotes:[`note-${sid}`],audit:{reviewed:true,warnings:[]}};
}

async function installRoutes(page){
  await page.route('**/api/health',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,models:['deepseek-v4-flash','deepseek-v4-pro']})}));
  await page.route('**/api/lexi',async route=>{
    const body=JSON.parse(route.request().postData()||'{}');calls.push(body);const word=body.word||'unknown';
    if(body.action==='analyze')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:analysisFor(word)})});
    if(body.action==='sense'){
      const k=`${word}:${body.sense?.id||'s1'}`;const n=(senseDelay.get(k)||0)+1;senseDelay.set(k,n);
      if((body.sense?.id||'s1')==='s1'&&n===1)await sleep(900); else await sleep(90);
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:packFor(word,body.sense?.id||'s1')})});
    }
    if(body.action==='review')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:{...body.pack,audit:{reviewed:true,warnings:[]}}})});
    if(body.action==='expand')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:{items:[{functionZh:'新增',zh:'新增中',en:'new en',de:'new de',fr:'new fr',confidence:'high'}]}})});
    return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:'BAD_TEST_ACTION'})});
  });
}

async function state(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('lexibridge4_state_v10')||'{}'));}
async function waitLoaded(page){await page.waitForFunction(()=>document.querySelector('#buildState')?.textContent.includes('10,000'));await page.waitForFunction(()=>!document.querySelector('#startBtn')?.disabled);}

const browser=await chromium.launch({headless:true});
const errors=[];
const context=await browser.newContext({viewport:{width:390,height:844}});
const page=await context.newPage();
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')errors.push(`console:${m.text()}`);});
await installRoutes(page);
await page.goto(BASE,{waitUntil:'domcontentloaded'});await waitLoaded(page);

// Static UX regression: natural wording restored.
assert.equal((await page.locator('#knownCurrent').textContent()).trim(),'这个词我认识');
assert.ok(!(await page.content()).includes('这一语言我原本就会'));

// Search morphology and rapid-query race: latest query must win.
await page.locator('[data-view="browseView"]').first().click();
await page.locator('#searchInput').fill('contaminated');
await page.waitForTimeout(250);
assert.match((await page.locator('#searchResults').textContent()).toLowerCase(),/contaminate/);
await page.locator('#searchInput').fill('conta');
await page.locator('#searchInput').fill('analysis');
await page.waitForTimeout(350);
const searchText=(await page.locator('#searchResults').textContent()).toLowerCase();
assert.ok(searchText.includes('analysis')||searchText.includes('ai 直接查询'),`latest search lost: ${searchText.slice(0,200)}`);

// Study: reveal then immediately mark known. Delayed old pack must never leak into next task.
await page.locator('.brandButton').click();await page.locator('#startBtn').click();
await page.locator('#revealBtn').waitFor({state:'visible'});
assert.equal((await page.locator('#langBadge').textContent()).trim(),'English');
const firstWord=(await page.locator('#studyCue').textContent()).trim();assert.ok(firstWord&&firstWord!=='—');
await page.locator('#revealBtn').click();await page.locator('#answer').waitFor({state:'visible'});
await page.locator('#knownCurrent').click();
await page.waitForFunction(()=>document.querySelector('#langBadge')?.textContent.trim()==='Deutsch');
assert.ok(await page.locator('#answer').evaluate(el=>el.classList.contains('hidden')));
assert.equal((await page.locator('#targetAnswer').textContent()).trim(),'—');
assert.equal((await page.locator('#studySense').textContent()).trim(),'');
assert.equal((await page.locator('#studyPreview').textContent()).trim(),'');
await page.waitForTimeout(1250);
assert.ok(await page.locator('#answer').evaluate(el=>el.classList.contains('hidden')),'old async answer became visible');
assert.equal((await page.locator('#studyPreview').textContent()).trim(),'','old async preview leaked into next task');
let st=await state(page);assert.equal(st.progress[`${firstWord}|s1|en`]?.known,true);assert.notEqual(st.progress[`${firstWord}|s1|de`]?.known,true);

// Reveal German task: cached pack must render German, not previous English.
await page.locator('#revealBtn').click();await page.locator('#answer').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#studyPreview')?.textContent.includes('de-col-s1'));
assert.ok(!(await page.locator('#studyPreview').textContent()).includes('en-col-s1'));

// Double-click protection: two synchronous clicks advance exactly one task.
await page.evaluate(()=>{const b=document.querySelector('#knownCurrent');b.click();b.click();});
await page.waitForFunction(()=>document.querySelector('#langBadge')?.textContent.trim()==='Français');
st=await state(page);assert.equal(st.progress[`${firstWord}|s1|de`]?.known,true);assert.notEqual(st.progress[`${firstWord}|s1|fr`]?.known,true);
await page.locator('#knownCurrent').click();await page.waitForFunction(w=>document.querySelector('#langBadge')?.textContent.trim()==='English'&&document.querySelector('#studyCue')?.textContent.trim()!==w,firstWord);
const secondWord=(await page.locator('#studyCue').textContent()).trim();assert.notEqual(secondWord,firstWord);
assert.ok(await page.locator('#answer').evaluate(el=>el.classList.contains('hidden')));assert.equal((await page.locator('#studyPreview').textContent()).trim(),'');

// Rating advances one task and records one review.
await page.locator('#revealBtn').click();await page.locator('#answer').waitFor({state:'visible'});await page.locator('[data-rate="good"]').click();
await page.waitForFunction(()=>document.querySelector('#langBadge')?.textContent.trim()==='Deutsch');
st=await state(page);assert.equal(st.reviews,1);

// Stress a sequence of transitions; no stale answer may survive task changes.
for(let i=0;i<8;i++){
  await page.locator('#revealBtn').waitFor({state:'visible'});await page.locator('#revealBtn').click();await page.locator('#answer').waitFor({state:'visible'});
  await page.locator(i%3===0?'[data-rate="good"]':'#knownCurrent').click();
  await page.waitForTimeout(80);
  if(await page.locator('#studyView').evaluate(el=>el.classList.contains('active'))){assert.ok(await page.locator('#answer').evaluate(el=>el.classList.contains('hidden')));}
}

// Detail race: changing sense while old auto-generation is pending cannot overwrite selected sense.
await page.locator('#endStudy').click();await page.locator('[data-view="browseView"]').first().click();await page.locator('#searchInput').fill(secondWord);await page.waitForTimeout(250);
await page.locator('.resultCard').first().click();await page.locator('#senseTabs .senseTab').nth(1).waitFor({state:'visible'});await page.locator('#senseTabs .senseTab').nth(1).click();
assert.match((await page.locator('#senseZh').textContent()),/第二义/);await page.waitForTimeout(1200);assert.match((await page.locator('#senseZh').textContent()),/第二义/,'old sense overwrote newer selection');
await page.locator('#loadSenseBtn').click();await page.waitForFunction(()=>!document.querySelector('#sensePack')?.classList.contains('hidden'));
assert.match(await page.locator('#formsGrid').textContent(),/sense2|de2-|fr2-/);
assert.equal(await page.locator('details.mediumEvidence').count(),1);
await page.locator('#closeDetail').click();

// Settings persistence.
await page.locator('[data-view="settingsView"]').first().click();await page.locator('#dailyNew').fill('7');await page.locator('#languageMode').selectOption('de');await page.locator('#saveSettings').click();st=await state(page);assert.equal(st.settings.dailyNew,7);assert.equal(st.settings.languageMode,'de');

// Mobile layout and error-free browser execution.
const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);assert.ok(overflow<=1,`mobile horizontal overflow ${overflow}px`);
assert.deepEqual(errors,[],`browser errors: ${errors.join('\n')}`);

// Desktop smoke in a fresh context.
const desktop=await browser.newContext({viewport:{width:1440,height:900}});const p2=await desktop.newPage();const errors2=[];p2.on('pageerror',e=>errors2.push(String(e)));await installRoutes(p2);await p2.goto(BASE,{waitUntil:'domcontentloaded'});await waitLoaded(p2);const over2=await p2.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);assert.ok(over2<=1,`desktop overflow ${over2}`);assert.deepEqual(errors2,[]);await desktop.close();

await context.close();await browser.close();
console.log(JSON.stringify({ok:true,firstWord,secondWord,apiCalls:calls.length,checks:['10k-load','known-wording','morph-search','search-race','study-race','language-scope','double-click','rating','8-transition-stress','sense-race','quality-tier','settings','mobile-layout','desktop-layout','console-errors']},null,2));
