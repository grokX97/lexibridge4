from pathlib import Path
p=Path('app.js')
s=p.read_text(encoding='utf-8')
old="$('#loadSenseBtn').onclick=loadSensePack;"
new="$('#loadSenseBtn').onclick=()=>loadSensePack();"
assert old in s,'loadSense binding missing'
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
assert "$('#loadSenseBtn').onclick=()=>loadSensePack();" in s
print('PATCH_V12F_OK')
