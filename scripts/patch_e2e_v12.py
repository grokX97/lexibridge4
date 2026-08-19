from pathlib import Path
p=Path('qa/e2e_v12.mjs')
s=p.read_text(encoding='utf-8')
old="""function analysisFor(word){
  return {word,wordFrequencyLabel:'中频',wordLevelNotesZh:`${word} 的测试词义说明`,senses:[
    {id:'s1',rank:1,pos:'noun',frequencyLabel:'核心义',zhDefinition:`核心中文-${word}`,zhExplanation:`核心解释-${word}`,register:'通用',domain:'测试',headwords:{en:{primary:word,alternatives:[]},de:{primary:`de-${word}`,alternatives:[]},fr:{primary:`fr-${word}`,alternatives:[]}},typicalContextsZh:[`核心情境-${word}`]},
    {id:'s2',rank:2,pos:'verb',frequencyLabel:'常用义',zhDefinition:`第二义-${word}`,zhExplanation:`第二义解释-${word}`,register:'通用',domain:'测试',headwords:{en:{primary:`${word}-sense2`,alternatives:[]},de:{primary:`de2-${word}`,alternatives:[]},fr:{primary:`fr2-${word}`,alternatives:[]}},typicalContextsZh:[`第二情境-${word}`]}
  ]};
}"""
new="""function analysisFor(word){
  const canonical=word==='contaminated'?'contaminate':word;
  return {word:canonical,inputForm:word,normalizationNoteZh:canonical!==word?`${word} → ${canonical}`:'',wordFrequencyLabel:'中频',wordLevelNotesZh:`${canonical} 的测试词义说明`,senses:[
    {id:'s1',rank:1,pos:'noun',frequencyLabel:'核心义',zhDefinition:`核心中文-${canonical}`,zhExplanation:`核心解释-${canonical}`,register:'通用',domain:'测试',headwords:{en:{primary:canonical,alternatives:[]},de:{primary:`de-${canonical}`,alternatives:[]},fr:{primary:`fr-${canonical}`,alternatives:[]}},typicalContextsZh:[`核心情境-${canonical}`]},
    {id:'s2',rank:2,pos:'verb',frequencyLabel:'常用义',zhDefinition:`第二义-${canonical}`,zhExplanation:`第二义解释-${canonical}`,register:'通用',domain:'测试',headwords:{en:{primary:`${canonical}-sense2`,alternatives:[]},de:{primary:`de2-${canonical}`,alternatives:[]},fr:{primary:`fr2-${canonical}`,alternatives:[]}},typicalContextsZh:[`第二情境-${canonical}`]}
  ]};
}"""
assert old in s,'analysisFor block not found'
s=s.replace(old,new)
old="""await page.locator('#searchInput').fill('contaminated');
await page.waitForTimeout(250);
assert.match((await page.locator('#searchResults').textContent()).toLowerCase(),/contaminate/);
await page.locator('#searchInput').fill('conta');"""
new="""await page.locator('#searchInput').fill('contaminated');
await page.waitForTimeout(250);
assert.match((await page.locator('#directLookup').textContent()).toLowerCase(),/contaminated/);
assert.match((await page.locator('#directLookup').textContent()),/识别词形/);
await page.locator('#directLookupBtn').click();
await page.waitForFunction(()=>document.querySelector('#detailWord')?.textContent.trim()==='contaminate');
assert.match(await page.locator('#detailBadges').textContent(),/contaminated.*contaminate/);
await page.locator('#closeDetail').click();
await page.locator('#searchInput').fill('conta');"""
assert old in s,'search morphology block not found'
s=s.replace(old,new)
old="""await page.waitForFunction(()=>document.querySelector('#langBadge')?.textContent.trim()==='Français');
st=await state(page);assert.equal(st.progress[`${firstWord}|s1|de`]?.known,true);assert.notEqual(st.progress[`${firstWord}|s1|fr`]?.known,true);
await page.locator('#knownCurrent').click();await page.waitForFunction(w=>document.querySelector('#langBadge')?.textContent.trim()==='English'&&document.querySelector('#studyCue')?.textContent.trim()!==w,firstWord);"""
new="""await page.waitForFunction(()=>document.querySelector('#langBadge')?.textContent.trim()==='Français');
st=await state(page);assert.equal(st.progress[`${firstWord}|s1|de`]?.known,true);assert.notEqual(st.progress[`${firstWord}|s1|fr`]?.known,true);
await page.locator('#revealBtn').waitFor({state:'visible'});await page.locator('#revealBtn').click();await page.locator('#answer').waitFor({state:'visible'});
await page.locator('#knownCurrent').click();await page.waitForFunction(w=>document.querySelector('#langBadge')?.textContent.trim()==='English'&&document.querySelector('#studyCue')?.textContent.trim()!==w,firstWord);"""
assert old in s,'French reveal-before-known block not found'
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
assert "detailWord')?.textContent.trim()==='contaminate'" in s
assert "langBadge')?.textContent.trim()==='Français'" in s
print('PATCH_E2E_V12_OK')
