from pathlib import Path
p=Path('index.html')
s=p.read_text(encoding='utf-8')
old='<option value="mastered">三语已掌握</option><option value="rich">已有 AI 词卡</option>'
new='<option value="mastered">三语已掌握</option><option value="partial">部分语言已掌握</option><option value="rich">已有 AI 词卡</option>'
assert old in s,'status option block missing'
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
print('PATCH_V12D_OK')
