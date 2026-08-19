from pathlib import Path
p=Path('app.js')
s=p.read_text(encoding='utf-8')
old="a=await api({action:'analyze',word:c.en,base});if(!Array.isArray(a?.senses)||!a.senses.length)throw new Error('DeepSeek 未返回有效义项');await putAnalysis(c.en,a);return a;"
new="a=await api({action:'analyze',word:c.en,base});if(!Array.isArray(a?.senses)||!a.senses.length)throw new Error('DeepSeek 未返回有效义项');if(a?.word&&norm(a.word)!==norm(c.en))await putAnalysis(a.word,a);await putAnalysis(c.en,a);return a;"
assert old in s
s=s.replace(old,new)
old="analysis=a;renderAnalysis();await selectSense(a.senses[0].id,true,epoch);"
new="if(c.custom&&a?.word&&norm(a.word)!==norm(c.en)){const input=c.en;c.en=String(a.word);c.searchText=norm(c.en);$('#detailWord').textContent=c.en;$('#detailBadges').innerHTML=`<span>AI 词形还原</span><span>${esc(input)} → ${esc(c.en)}</span>`;}analysis=a;renderAnalysis();await selectSense(a.senses[0].id,true,epoch);"
assert old in s
s=s.replace(old,new)
start=s.index('function renderDirectLookup(total){')
end=s.index('function resetFilters()',start)
replacement="""function renderDirectLookup(total){const q=$('#searchInput').value.trim();const valid=/^[A-Za-z][A-Za-z' -]{1,60}$/.test(q);$('#directLookup').innerHTML=valid&&!cards.some(c=>norm(c.en)===norm(q))?`<button class=\"directLookup\" id=\"directLookupBtn\"><b>AI 识别词形 / 查询 “${esc(q)}”</b><span>自动判断是否为变形并还原到词典原形；不在 10,000 底库也可建立完整多义词卡</span></button>`:'';$('#directLookupBtn')?.addEventListener('click',()=>openDetail(directCard(q)));}\n"""
s=s[:start]+replacement+s[end:]
p.write_text(s,encoding='utf-8')
assert 'AI 识别词形 / 查询' in s
assert "await putAnalysis(a.word,a)" in s
print('PATCH_V12B_OK')
