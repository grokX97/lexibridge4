from pathlib import Path
p=Path('qa/e2e_v12.mjs')
s=p.read_text(encoding='utf-8')
s=s.replace("fr:{primary:`fr-${canonical}`,alternatives:[]}","fr:{primary:'lundi',alternatives:[]}")
s=s.replace("fr:{primary:`fr2-${canonical}`,alternatives:[]}","fr:{primary:'lundi-sense2',alternatives:[]}")
old="""await page.waitForFunction(()=>document.querySelector('#langBadge')?.textContent.trim()==='Français');
st=await state(page);assert.equal(st.progress[`${firstWord}|s1|de`]?.known,true);assert.notEqual(st.progress[`${firstWord}|s1|fr`]?.known,true);
await page.locator('#revealBtn').waitFor({state:'visible'});"""
new="""await page.waitForFunction(()=>document.querySelector('#langBadge')?.textContent.trim()==='Français');
assert.equal((await page.locator('#studyCue').textContent()).trim(),'lundi','exact stale-content regression target did not become lundi');
assert.ok(await page.locator('#answer').evaluate(el=>el.classList.contains('hidden')),'previous answer remained visible under lundi');
assert.equal((await page.locator('#studyPreview').textContent()).trim(),'','previous lower content remained under lundi');
st=await state(page);assert.equal(st.progress[`${firstWord}|s1|de`]?.known,true);assert.notEqual(st.progress[`${firstWord}|s1|fr`]?.known,true);
await page.locator('#revealBtn').waitFor({state:'visible'});"""
assert old in s,'French transition block missing for lundi regression'
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
assert "'lundi','exact stale-content regression" in s
print('PATCH_E2E_V12E_OK')
