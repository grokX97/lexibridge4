from pathlib import Path
p=Path('qa/e2e_v12.mjs')
s=p.read_text(encoding='utf-8')
old="""await page.locator('#revealBtn').click();await page.locator('#answer').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#studyPreview')?.textContent.includes('de-col-s1'));
assert.ok(!(await page.locator('#studyPreview').textContent()).includes('en-col-s1'));
"""
new="""await page.locator('#revealBtn').click();await page.locator('#answer').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#studyPreview')?.textContent.includes('de-col-s1'));
assert.ok(!(await page.locator('#studyPreview').textContent()).includes('en-col-s1'));
assert.equal(calls.filter(x=>x.action==='sense'&&x.word===firstWord&&x.sense?.id==='s1').length,1,'same sense generated twice while switching target language');
"""
assert old in s,'German preview block missing'
s=s.replace(old,new)
old="""await desktop.close();

await context.close();await browser.close();
console.log(JSON.stringify({ok:true,firstWord,secondWord,apiCalls:calls.length,checks:['10k-load','known-wording','morph-search','search-race','study-race','language-scope','double-click','rating','8-transition-stress','sense-race','quality-tier','settings','mobile-layout','desktop-layout','console-errors']},null,2));
"""
new="""await desktop.close();

// Interrupted-session recovery: unfinished DE/FR tasks must survive a reload instead of disappearing.
const recovery=await browser.newContext({viewport:{width:390,height:844}});const pr=await recovery.newPage();await installRoutes(pr);await pr.goto(BASE,{waitUntil:'domcontentloaded'});await waitLoaded(pr);await pr.locator('#startBtn').click();await pr.locator('#revealBtn').waitFor({state:'visible'});const recoveryWord=(await pr.locator('#studyCue').textContent()).trim();await pr.locator('#revealBtn').click();await pr.locator('#answer').waitFor({state:'visible'});await pr.locator('#knownCurrent').click();await pr.waitForFunction(()=>document.querySelector('#langBadge')?.textContent.trim()==='Deutsch');await pr.reload({waitUntil:'domcontentloaded'});await waitLoaded(pr);assert.equal((await pr.locator('#mastered').textContent()).trim(),'0','one-language known state was incorrectly counted as three-language mastery');await pr.locator('#startBtn').click();await pr.waitForFunction(()=>document.querySelector('#langBadge')?.textContent.trim()==='Deutsch');assert.equal((await pr.locator('#studyCue').textContent()).trim(),`de-${recoveryWord}`,'unfinished German task was lost across reload');await recovery.close();

await context.close();await browser.close();
console.log(JSON.stringify({ok:true,firstWord,secondWord,apiCalls:calls.length,checks:['10k-load','known-wording','canonical-inflection-lookup','search-race','study-race','language-scope','paid-request-dedupe','double-click','rating','8-transition-stress','sense-race','quality-tier','settings','unfinished-session-recovery','three-language-mastery-status','mobile-layout','desktop-layout','console-errors']},null,2));
"""
assert old in s,'final QA block missing'
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
print('PATCH_E2E_V12C_OK')
