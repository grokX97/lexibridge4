from pathlib import Path
p=Path('qa/e2e_v12.mjs')
s=p.read_text(encoding='utf-8')
old="const browser=await chromium.launch({headless:true});"
new="const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});"
assert old in s,'browser launch block missing'
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
print('PATCH_E2E_V12D_OK')
