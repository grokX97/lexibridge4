from pathlib import Path
p=Path('qa/e2e_v12.mjs')
s=p.read_text(encoding='utf-8')
old="""// Settings persistence.
await page.locator('[data-view="settingsView"]').first().click();await page.locator('#dailyNew').fill('7');"""
new="""// Settings persistence via the same visible navigation a user has from Browse.
await page.locator('#browseView [data-view="homeView"]').click();await page.locator('#homeView [data-view="settingsView"]').click();await page.locator('#dailyNew').fill('7');"""
assert old in s,'settings navigation block missing'
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
print('PATCH_E2E_V12F_OK')
