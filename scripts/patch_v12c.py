from pathlib import Path
p=Path('app.js')
s=p.read_text(encoding='utf-8')

# Dedupe concurrent paid AI requests for the same word / sense.
s=s.replace("const aMem=new Map(), pMem=new Map();", "const aMem=new Map(), pMem=new Map(), analysisFlights=new Map(), packFlights=new Map();")
old="async function ensureAnalysis(c){let a=await getAnalysis(c.en);if(a)return a;const base={rank:c.rank,pos:c.pos,englishDefinitionHint:c.base.enDef,zhHint:c.base.zh,deHint:c.base.de,frHint:c.base.fr,note:'这些只是旧词库线索，可能是冷僻义或错误翻译，请独立判断'};a=await api({action:'analyze',word:c.en,base});if(!Array.isArray(a?.senses)||!a.senses.length)throw new Error('DeepSeek 未返回有效义项');if(a?.word&&norm(a.word)!==norm(c.en))await putAnalysis(a.word,a);await putAnalysis(c.en,a);return a;}"
new="async function ensureAnalysis(c){let a=await getAnalysis(c.en);if(a)return a;const key=norm(c.en);if(analysisFlights.has(key))return analysisFlights.get(key);const job=(async()=>{const base={rank:c.rank,pos:c.pos,englishDefinitionHint:c.base.enDef,zhHint:c.base.zh,deHint:c.base.de,frHint:c.base.fr,note:'这些只是旧词库线索，可能是冷僻义或错误翻译，请独立判断'};const out=await api({action:'analyze',word:c.en,base});if(!Array.isArray(out?.senses)||!out.senses.length)throw new Error('DeepSeek 未返回有效义项');if(out?.word&&norm(out.word)!==norm(c.en))await putAnalysis(out.word,out);await putAnalysis(c.en,out);return out;})();analysisFlights.set(key,job);try{return await job;}finally{if(analysisFlights.get(key)===job)analysisFlights.delete(key);}}"
assert old in s,'canonical ensureAnalysis block missing'
s=s.replace(old,new)
old="async function ensurePack(c,s,force=false){let p=force?null:await getPack(c.en,s.id);if(p)return p;p=await api({action:'sense',word:c.en,sense:s});if(state.settings.autoReview){try{p=await api({action:'review',word:c.en,sense:s,pack:p});}catch(e){p.audit=p.audit||{};p.audit.warnings=[...(p.audit.warnings||[]),`二次校对失败：${e.message}`];}}await putPack(c.en,s.id,p);return p;}"
new="async function ensurePack(c,s,force=false){let p=force?null:await getPack(c.en,s.id);if(p)return p;const key=pKey(c.en,s.id);if(packFlights.has(key))return packFlights.get(key);const job=(async()=>{let out=await api({action:'sense',word:c.en,sense:s});if(state.settings.autoReview){try{out=await api({action:'review',word:c.en,sense:s,pack:out});}catch(e){out.audit=out.audit||{};out.audit.warnings=[...(out.audit.warnings||[]),`二次校对失败：${e.message}`];}}await putPack(c.en,s.id,out);return out;})();packFlights.set(key,job);try{return await job;}finally{if(packFlights.get(key)===job)packFlights.delete(key);}}"
assert old in s,'ensurePack block missing'
s=s.replace(old,new)

# Three-language status must not call a word mastered just because one language is known.
old="function conceptMastered(word,sid){return enabledLangs().every(l=>masteredTrack(track(word,sid,l)));}\nfunction wordStatus(c){const prefix=norm(c.en)+'|',ts=Object.entries(state.progress).filter(([k])=>k.startsWith(prefix)).map(([,v])=>v);if(!ts.length)return'new';if(ts.some(t=>t.due&&t.due<=Date.now()&&!masteredTrack(t)))return'due';if(ts.length&&ts.every(masteredTrack))return'mastered';return'learning';}"
new="function conceptMastered(word,sid){return LANGS.every(l=>masteredTrack(track(word,sid,l)));}\nfunction wordStatus(c){const prefix=norm(c.en)+'|',rows=Object.entries(state.progress).filter(([k])=>k.startsWith(prefix));if(!rows.length)return'new';const groups=new Map();for(const [k,t] of rows){const [,sid,lang]=k.split('|');if(!groups.has(sid))groups.set(sid,new Map());groups.get(sid).set(lang,t);}let anyDone=false,allDone=true;for(const m of groups.values()){const ts=LANGS.map(l=>m.get(l)||null);if(ts.some(t=>t?.due&&t.due<=Date.now()&&!masteredTrack(t)))return'due';if(ts.some(masteredTrack))anyDone=true;if(!ts.every(masteredTrack))allDone=false;}if(allDone)return'mastered';if(anyDone)return'partial';return'learning';}"
assert old in s,'status block missing'
s=s.replace(old,new)

# Persist unfinished target languages so closing the app mid-concept cannot silently lose them.
old="function dueTasks(){const now=Date.now(),out=[];for(const [k,t] of Object.entries(state.progress)){if(!t.active||masteredTrack(t)||!t.due||t.due>now)continue;const [w,sid,lang]=k.split('|'),c=byWord.get(w)||directCard(w);out.push({card:c,sid,lang,due:t.due,newConcept:false});}return out.sort((a,b)=>a.due-b.due);}\nfunction newConceptCards()"
new="function dueTasks(){const now=Date.now(),out=[];for(const [k,t] of Object.entries(state.progress)){if(!t.active||masteredTrack(t)||!t.due||t.due>now)continue;const [w,sid,lang]=k.split('|'),c=byWord.get(w)||directCard(w);out.push({card:c,sid,lang,due:t.due,newConcept:false});}return out.sort((a,b)=>a.due-b.due);}\nfunction pendingTasks(limit=90){const groups=new Map();for(const [k,t] of Object.entries(state.progress)){if(!t.active)continue;const [w,sid]=k.split('|');groups.set(`${w}|${sid}`,{w,sid});}const out=[];for(const g of groups.values()){for(const lang of enabledLangs()){if(out.length>=limit)return out;let t=track(g.w,g.sid,lang);if(!t){t=track(g.w,g.sid,lang,true);t.active=true;}if(t.active&&!masteredTrack(t)&&!(t.reviews>0)&&!t.due){const c=byWord.get(g.w)||directCard(g.w);out.push({card:c,sid:g.sid,lang,due:0,newConcept:false,pending:true});}}}return out;}\nfunction newConceptCards()"
assert old in s,'due/new block missing'
s=s.replace(old,new)

# Candidate buildQueue comes from patch_v12.py.
old="function buildQueue(){const due=dueTasks().slice(0,Number(state.settings.reviewCap||90)),fresh=[];for(const c of newConceptCards())for(const lang of enabledLangs())fresh.push({card:c,sid:null,lang,newConcept:true,due:Infinity});return [...due,...fresh];}"
new="function buildQueue(){const cap=Number(state.settings.reviewCap||90),due=dueTasks().slice(0,cap),pending=pendingTasks(Math.max(0,cap-due.length)),fresh=[];for(const c of newConceptCards())for(const lang of enabledLangs())fresh.push({card:c,sid:null,lang,newConcept:true,due:Infinity});return [...due,...pending,...fresh];}"
assert old in s,'patched buildQueue missing'
s=s.replace(old,new)

# As soon as the primary sense is resolved, persist every enabled language as unfinished.
old="const s=a.senses.find(x=>x.id===task.sid)||a.senses[0];task.sid=s.id;task.sense=s;\n    const t=track(c.en,s.id,task.lang,true),dir=direction(t);"
new="const s=a.senses.find(x=>x.id===task.sid)||a.senses[0];task.sid=s.id;task.sense=s;if(task.newConcept){for(const l of enabledLangs()){const pending=track(c.en,s.id,l,true);pending.active=true;}}\n    const t=track(c.en,s.id,task.lang,true),dir=direction(t);"
assert old in s,'showTask sense block missing'
s=s.replace(old,new)

p.write_text(s,encoding='utf-8')
for needle in ['analysisFlights','packFlights','function pendingTasks','return\'partial\'','for(const l of enabledLangs())']:
    assert needle in s,needle
print('PATCH_V12C_OK')
