from pathlib import Path
p=Path('app.js')
s=p.read_text(encoding='utf-8')
old="async function selectSense(id,auto,existingEpoch=null){const epoch=existingEpoch??++detailEpoch,card=detailCard,a=analysis;if(!card||!a)return;const selected=a.senses.find(x=>x.id===id)||a.senses[0];"
new="async function selectSense(id,auto,existingEpoch=null){const epoch=existingEpoch??++detailEpoch,card=detailCard,a=analysis;if(!card||!a)return;clearSenseBusy();const selected=a.senses.find(x=>x.id===id)||a.senses[0];"
assert old in s,'selectSense start missing'
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
assert 'if(!card||!a)return;clearSenseBusy();const selected=' in s
print('PATCH_V12E_OK')
