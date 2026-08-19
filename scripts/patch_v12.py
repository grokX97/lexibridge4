from pathlib import Path
import re

APP=Path('app.js')
IDX=Path('index.html')
SW=Path('sw.js')
CSS=Path('styles.css')
s=APP.read_text(encoding='utf-8')

# Global async/race guards.
s=s.replace(
"let detailCard=null, analysis=null, sense=null, sensePack=null, queue=[], qi=0, currentTask=null;\nconst aMem=new Map(), pMem=new Map();",
"let detailCard=null, analysis=null, sense=null, sensePack=null, queue=[], qi=0, currentTask=null;\nlet studyEpoch=0, detailEpoch=0, searchEpoch=0, advancing=false;\nconst aMem=new Map(), pMem=new Map();"
)

# Replace study transition block with tokenized, stale-safe rendering.
start=s.index('function buildQueue(){')
end=s.index('function rememberRecent', start)
new_study=r'''function buildQueue(){const due=dueTasks().slice(0,Number(state.settings.reviewCap||90)),fresh=[];for(const c of newConceptCards())for(const lang of enabledLangs())fresh.push({card:c,sid:null,lang,newConcept:true,due:Infinity});return [...due,...fresh];}
function setStudyActionLock(v){$$('.rating button').forEach(b=>b.disabled=v);$('#knownCurrent').disabled=v;$('#revealBtn').disabled=v;}
function resetStudySurface(){
  $('#studyLoader').innerHTML='<span class="spinner"></span><span>正在分析常用义项…</span>';
  $('#studyLoader').classList.add('hidden');$('#revealBtn').classList.add('hidden');$('#answer').classList.add('hidden');
  $('#targetAnswer').textContent='—';$('#studySense').innerHTML='';$('#studyPreview').innerHTML='';
  $('#answerSpeakBtn').onclick=null;$('#studySpeakBtn').onclick=null;
  $('#studyCue').textContent='—';$('#cueLabel').textContent='正在准备';$('#recallPrompt').textContent='正在分析当前词的常用义项…';
  for(const id of ['bandBadge','posBadge','langBadge','directionBadge','statusBadge'])$('#'+id).textContent='';
}
async function startStudy(){queue=buildQueue();qi=0;if(!queue.length){toast('今天没有到期任务或新概念');return;}switchView('studyView');await showTask();}
async function showTask(){
  const task=queue[qi]||null, epoch=++studyEpoch;currentTask=task;resetStudySurface();
  if(!task){toast('今日学习完成');switchView('homeView');renderHome();return;}
  const c=task.card;$('#studyLoader').classList.remove('hidden');
  try{
    const a=await ensureAnalysis(c);if(epoch!==studyEpoch||currentTask!==task)return;
    const s=a.senses.find(x=>x.id===task.sid)||a.senses[0];task.sid=s.id;task.sense=s;
    const t=track(c.en,s.id,task.lang,true),dir=direction(t);task.direction=dir;saveState();
    const hw=s.headwords?.[task.lang]?.primary || (task.lang==='en'?c.en:'—');
    $('#studyProgress').textContent=`${qi+1} / ${queue.length}`;$('#queueLabel').textContent=task.newConcept?'新概念':'到期复习';
    $('#progressBar').style.width=`${Math.round(qi/queue.length*100)}%`;$('#bandBadge').textContent=c.band.label;$('#posBadge').textContent=POS_ZH[s.pos]||s.pos;
    $('#langBadge').textContent=LM[task.lang].name;$('#directionBadge').textContent=dir==='recognition'?'识别：目标语 → 中文':'产出：中文 → 目标语';
    $('#statusBadge').textContent=masteredTrack(t)?'已掌握':t.reviews?'学习中':'新任务';
    if(dir==='recognition'){$('#cueLabel').textContent=`识别 ${LM[task.lang].name}`;$('#studyCue').textContent=hw;$('#recallPrompt').textContent='先说出这个词在当前义项下的准确中文意思；不要借另外两种语言猜。';$('#studySpeakBtn').classList.remove('hidden');$('#studySpeakBtn').onclick=()=>speak(hw,LM[task.lang].locale);}
    else{$('#cueLabel').textContent=`产出 ${LM[task.lang].name}`;$('#studyCue').textContent=s.zhDefinition;$('#recallPrompt').textContent=`根据中文核心义主动说出 ${LM[task.lang].name}；尽量连同冠词或重要词形一起回忆。`;$('#studySpeakBtn').classList.add('hidden');}
    if(epoch!==studyEpoch||currentTask!==task)return;$('#studyLoader').classList.add('hidden');$('#revealBtn').classList.remove('hidden');
  }catch(e){if(epoch!==studyEpoch||currentTask!==task)return;$('#studyLoader').innerHTML=`<span>${esc(e.message)}</span>`;toast('词义分析失败');}
}
async function revealTask(){
  const task=currentTask,epoch=studyEpoch;if(!task||advancing)return;const {card:c,sense:s,lang}=task,hw=s.headwords?.[lang]?.primary||(lang==='en'?c.en:'—');
  $('#targetAnswer').textContent=hw;$('#answerSpeakBtn').onclick=()=>speak(hw,LM[lang].locale);$('#studySense').innerHTML=`<div><small>${esc(s.frequencyLabel||'')}</small><b>${esc(s.zhDefinition)}</b><p>${esc(s.zhExplanation||'')}</p></div>`;
  $('#studyPreview').innerHTML='<div class="loaderBox"><span class="spinner"></span><span>正在准备该义项的高价值搭配与例句…</span></div>';$('#answer').classList.remove('hidden');$('#revealBtn').classList.add('hidden');
  const p=await getPack(c.en,s.id);if(epoch!==studyEpoch||currentTask!==task)return;
  if(!p){ensurePack(c,s).then(x=>{if(epoch===studyEpoch&&currentTask===task&&!$('#answer').classList.contains('hidden'))renderStudyPreview(x,lang,task,epoch);}).catch(()=>{if(epoch===studyEpoch&&currentTask===task&&!$('#answer').classList.contains('hidden'))$('#studyPreview').innerHTML='<p class="muted">详细学习包暂未生成，可在完整词卡中重试。</p>';});}
  else renderStudyPreview(p,lang,task,epoch);
}
function renderStudyPreview(p,lang,task=currentTask,epoch=studyEpoch){if(epoch!==studyEpoch||currentTask!==task)return;const cols=(p?.collocations||[]).filter(x=>String(x.confidence||'high').toLowerCase()==='high').slice(0,2),ex=(p?.examples||[])[0];$('#studyPreview').innerHTML=`<div class="miniPreview">${cols.map(x=>`<p><b>${esc(x.functionZh||x.zh)}</b><br><span>${esc(x.zh)} → ${esc(x[lang])}</span></p>`).join('')}${ex?`<p><b>${esc(ex.scenarioZh||'例句')}</b><br><span>${esc(ex.zh)}<br>${esc(ex[lang])}</span></p>`:''}</div>`;}
async function advanceTask(mutator){if(!currentTask||advancing)return;advancing=true;setStudyActionLock(true);const task=currentTask;++studyEpoch;try{mutator(task);saveState();qi++;renderHome();await showTask();}finally{advancing=false;setStudyActionLock(false);}}
function rate(kind){return advanceTask(task=>{const {card:c,sid,lang,direction:dir}=task,t=track(c.en,sid,lang,true),old=Number(t.interval||0);let days;if(kind==='again'){t.streak=0;t.reps=Math.max(0,t.reps-1);days=10/(60*24);if(dir==='recognition')t.recognition=Math.max(0,(t.recognition||0)-1);else t.production=Math.max(0,(t.production||0)-1);}else{t.streak++;t.reps++;if(dir==='recognition')t.recognition=(t.recognition||0)+1;else t.production=(t.production||0)+1;days=kind==='hard'?(old?Math.max(1,old*1.35):1):kind==='good'?(old?Math.max(2,old*2.35):2):(old?Math.max(4,old*3.2):4);}t.interval=Math.round(days*100)/100;t.due=Date.now()+days*DAY;t.last=Date.now();t.reviews++;t.known=false;t.active=true;t.mastered=t.reps>=Number(state.settings.masterReps)&&t.streak>=3&&t.interval>=Number(state.settings.masterDays)&&(t.recognition||0)>=2&&(t.production||0)>=2;state.reviews++;rememberRecent(c.en,sid,lang);});}
function markKnown(){return advanceTask(task=>{const t=track(task.card.en,task.sid,task.lang,true);t.known=true;t.mastered=true;t.last=Date.now();t.due=0;t.active=true;rememberRecent(task.card.en,task.sid,task.lang);});}
'''
s=s[:start]+new_study+s[end:]

# Search result rendering: latest query wins.
start=s.index('async function renderSearch(){')
end=s.index('function renderDirectLookup', start)
new_search=r'''async function renderSearch(){const epoch=++searchEpoch;filters.status=$('#statusFilter').value;filters.pos=$('#posFilter').value;filters.sort=$('#sortFilter').value;const arr=filtered(),size=Number(state.settings.pageSize)||40,pages=Math.max(1,Math.ceil(arr.length/size));filters.page=Math.min(Math.max(1,filters.page),pages);const start=(filters.page-1)*size,vis=arr.slice(start,start+size);$('#resultSummary').textContent=`共 ${arr.length.toLocaleString()} 个结果 · 显示 ${arr.length?start+1:0}–${Math.min(start+size,arr.length)}`;$('#pageInfo').textContent=`第 ${filters.page} / ${pages} 页`;$('#prevPage').disabled=filters.page<=1;$('#nextPage').disabled=filters.page>=pages;$('#pager').classList.toggle('hidden',!arr.length);$('#searchResults').innerHTML=vis.length?'<div class="loaderBox"><span class="spinner"></span><span>正在读取已缓存 AI 词义…</span></div>':'<div class="empty">没有词库匹配</div>';if(vis.length){const html=await Promise.all(vis.map(resultHTML));if(epoch!==searchEpoch)return;$('#searchResults').innerHTML=html.join('');$$('.resultCard').forEach(b=>b.onclick=()=>openDetail(b.dataset.rank!=='0'?byRank.get(Number(b.dataset.rank)):directCard(b.dataset.word)));}if(epoch===searchEpoch)renderDirectLookup(arr.length);}
'''
s=s[:start]+new_search+s[end:]

# Detail rendering: stale analysis/sense/pack responses cannot overwrite a newer selection.
start=s.index('async function openDetail(c){')
end=s.index('function renderAnalysis()', start)
new_open=r'''async function openDetail(c){if(!c)return;const epoch=++detailEpoch;detailCard=c;analysis=null;sense=null;sensePack=null;$('#detailWord').textContent=c.en;$('#favoriteBtn').textContent=state.favorites[norm(c.en)]?'★':'☆';$('#detailBadges').innerHTML=`<span>${c.rank?'#'+c.rank:'AI 直接查询'}</span><span>${esc(POS_ZH[c.pos]||c.pos)}</span><span>${esc(c.band.label)}</span>`;$('#detailBackdrop').classList.remove('hidden');document.body.style.overflow='hidden';$('#detailLoading').classList.remove('hidden');$('#detailError').classList.add('hidden');$('#analysisBox').classList.add('hidden');$('#sensePack').classList.add('hidden');try{const a=await ensureAnalysis(c);if(epoch!==detailEpoch||detailCard!==c)return;analysis=a;renderAnalysis();await selectSense(a.senses[0].id,true,epoch);}catch(e){if(epoch!==detailEpoch||detailCard!==c)return;$('#detailLoading').classList.add('hidden');$('#detailError').classList.remove('hidden');$('#detailError').innerHTML=`<b>词义分析失败</b><p>${esc(e.message)}</p><button class="secondary" id="retryAnalysis">重试</button>`;$('#retryAnalysis').onclick=()=>openDetail(c);}}
function closeDetail(){detailEpoch++;$('#detailBackdrop').classList.add('hidden');document.body.style.overflow='';detailCard=null;analysis=null;sense=null;sensePack=null;}
'''
s=s[:start]+new_open+s[end:]

start=s.index('async function selectSense(')
end=s.index('function setSenseBusy', start)
new_sense=r'''async function selectSense(id,auto,existingEpoch=null){const epoch=existingEpoch??++detailEpoch,card=detailCard,a=analysis;if(!card||!a)return;const selected=a.senses.find(x=>x.id===id)||a.senses[0];sense=selected;sensePack=null;$$('.senseTab').forEach(b=>b.classList.toggle('active',b.dataset.sid===selected.id));$('#senseFreq').textContent=`${selected.frequencyLabel||''} · ${POS_ZH[selected.pos]||selected.pos}`;$('#senseZh').textContent=selected.zhDefinition||'—';$('#senseExplain').textContent=selected.zhExplanation||'';$('#senseMeta').textContent=[selected.register,selected.domain,selected.notesZh].filter(Boolean).join(' · ');$('#headwordGrid').innerHTML=['en','de','fr'].map(l=>{const h=selected.headwords?.[l]||{};return `<div class="headword"><small>${LM[l].name}</small><b>${esc(h.primary||'—')}</b><p>${(h.alternatives||[]).map(esc).join(' · ')}</p>${h.noteZh?`<em>${esc(h.noteZh)}</em>`:''}<button class="miniSpeak" data-speak="${esc(h.primary||'')}" data-lang="${LM[l].locale}">🔊</button></div>`;}).join('');bindSpeech($('#headwordGrid'));$('#senseContexts').innerHTML=(selected.typicalContextsZh||[]).map(x=>`<span>${esc(x)}</span>`).join('');$('#sensePack').classList.add('hidden');const p=await getPack(card.en,selected.id);if(epoch!==detailEpoch||detailCard!==card||analysis!==a||sense!==selected)return;sensePack=p;renderDetailProgress();if(p){renderSensePack();$('#loadSenseBtn').textContent='重新生成此义项';}else{$('#sensePack').classList.add('hidden');$('#loadSenseBtn').textContent='生成此义项完整学习包';if(auto)await loadSensePack(epoch,card,selected);}}
async function loadSensePack(epoch=detailEpoch,card=detailCard,selected=sense){if(!card||!selected)return;setSenseBusy('正在生成词形、词族、近义差异、搭配和四语例句…');try{const p=await ensurePack(card,selected,true);if(epoch!==detailEpoch||detailCard!==card||sense!==selected)return;sensePack=p;renderSensePack();$('#loadSenseBtn').textContent='重新生成此义项';toast(sensePack?.audit?.reviewed?'生成并二次校对完成':'学习包生成完成');}catch(e){if(epoch===detailEpoch&&detailCard===card&&sense===selected)toast(e.message);}finally{if(epoch===detailEpoch&&detailCard===card&&sense===selected)clearSenseBusy();}}
'''
s=s[:start]+new_sense+s[end:]

# Guard manual review/expansion against sense switching while requests are in flight.
start=s.index('async function reviewPack(){')
end=s.index('function enabledLangs()', start)
new_review=r'''async function reviewPack(){const epoch=detailEpoch,card=detailCard,selected=sense,pack=sensePack;if(!card||!selected||!pack)return;setSenseBusy('DeepSeek 正在独立二次校对…');try{const p=await api({action:'review',word:card.en,sense:selected,pack});if(epoch!==detailEpoch||detailCard!==card||sense!==selected)return;sensePack=p;await putPack(card.en,selected.id,p);renderSensePack();toast('二次校对完成');}catch(e){if(epoch===detailEpoch&&detailCard===card&&sense===selected)toast(e.message);}finally{if(epoch===detailEpoch&&detailCard===card&&sense===selected)clearSenseBusy();}}
async function expand(kind){const epoch=detailEpoch,card=detailCard,selected=sense,pack=sensePack;if(!card||!selected||!pack)return;setSenseBusy(kind==='collocations'?'正在扩展并校对搭配…':'正在扩展并校对四语例句…');try{const d=await api({action:'expand',word:card.en,sense:selected,pack,kind});if(epoch!==detailEpoch||detailCard!==card||sense!==selected)return;const rows=Array.isArray(d?.items)?d.items:[],field=kind==='examples'?'examples':'collocations',old=Array.isArray(pack[field])?[...pack[field]]:[],seen=new Set(old.map(x=>norm([x.zh,x.en,x.de,x.fr].join('|'))));for(const x of rows){const k=norm([x.zh,x.en,x.de,x.fr].join('|'));if(k&&!seen.has(k)){old.push(x);seen.add(k);}}let next={...pack,[field]:old};if(state.settings.autoReview&&rows.length)next=await api({action:'review',word:card.en,sense:selected,pack:next});if(epoch!==detailEpoch||detailCard!==card||sense!==selected)return;sensePack=next;await putPack(card.en,selected.id,next);renderSensePack();toast(rows.length?`候选新增 ${rows.length} 条，已完成终审`:'没有更多足够可靠的新内容');}catch(e){if(epoch===detailEpoch&&detailCard===card&&sense===selected)toast(e.message);}finally{if(epoch===detailEpoch&&detailCard===card&&sense===selected)clearSenseBusy();}}
'''
s=s[:start]+new_review+s[end:]

# Natural wording for the skip/known action and status.
s=s.replace("t?.known?'原本已会':t?.mastered?'已掌握'", "t?.known?'已认识':t?.mastered?'已掌握'")

APP.write_text(s,encoding='utf-8')

html=IDX.read_text(encoding='utf-8')
html=html.replace('这一语言我原本就会','这个词我认识')
html=html.replace('id="knownCurrent">这个词我认识','id="knownCurrent" title="只标记当前显示的这个词；其他语言仍独立学习">这个词我认识')
html=html.replace('?v=11','?v=12')
IDX.write_text(html,encoding='utf-8')

sw=SW.read_text(encoding='utf-8').replace('lexibridge4-v11','lexibridge4-v12').replace('?v=11','?v=12')
SW.write_text(sw,encoding='utf-8')

css=CSS.read_text(encoding='utf-8')
if '.secondary:disabled' not in css:
    css += '\n.rating button:disabled,#knownCurrent:disabled{pointer-events:none;opacity:.45}\n'
CSS.write_text(css,encoding='utf-8')

# Hard assertions: fail rather than silently shipping a partial patch.
final=APP.read_text(encoding='utf-8')
for needle in ['studyEpoch','detailEpoch','searchEpoch','currentTask!==task','detailCard!==card','Promise.all(vis.map(resultHTML))','advanceTask(mutator)']:
    assert needle in final, needle
assert '这一语言我原本就会' not in IDX.read_text(encoding='utf-8')
assert 'app.js?v=12' in IDX.read_text(encoding='utf-8')
print('PATCH_V12_OK')
