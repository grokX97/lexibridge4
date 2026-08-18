(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const DAY = 86400000;
  const POS = ['noun','verb','adjective','adverb','phrase'];
  const LEVEL = ['A1','A2','B1','B2','C1','C2'];
  const BAND = rank => rank <= 2500 ? ['core','核心 1–2500'] : rank <= 5000 ? ['upper','中高级 2501–5000'] : rank <= 8000 ? ['academic','学术 5001–8000'] : ['advanced','高级 8001–10000'];
  const STORE = 'lexibridge4_state_v2';
  const today = () => { const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); };
  const defaultState = () => ({settings:{dailyNew:12,reviewCap:120,startRank:2501,masterReps:5,masterDays:30,theme:'system'},progress:{},reviews:0,version:2});
  let state = loadState();
  let cards = [];
  let queue = [], qi = 0, current = null, activeBand='all', searchLimit=100;

  function loadState(){
    try { const x=JSON.parse(localStorage.getItem(STORE)); return x && x.progress ? {...defaultState(),...x,settings:{...defaultState().settings,...x.settings}} : defaultState(); }
    catch { return defaultState(); }
  }
  function saveState(){ localStorage.setItem(STORE, JSON.stringify(state)); }
  function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._tm); t._tm=setTimeout(()=>t.classList.remove('show'),1800); }
  function esc(s=''){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function cardId(c){ return `${c.en}-${c.pos}-${c.synset||c.rank}`; }
  function ensureP(c){ const id=cardId(c); return state.progress[id] ||= {reps:0,streak:0,interval:0,due:0,reviews:0,known:false,mastered:false,last:0}; }
  function makeCard(r, idx){
    const rank=idx+1, [bandId,bandLabel]=BAND(rank);
    const pos=typeof r[1]==='number' ? (POS[r[1]]||'word') : r[1];
    const level=LEVEL[r[2]]||'C1';
    const en=r[0], men=r[4], zh=r[5], de=r[6], fr=r[7];
    return {en,pos,level,topic:(window.LB4_TOPICS||[])[r[3]]||'通用',meaning:{en:men,zh,de,fr},rank,frequencyRank:r[8],frequencyCount:r[9],synset:r[10],quality:r[11]===1?'curated':'aligned',band:{id:bandId,label:bandLabel},
      phrase:{en:`${en}: ${men}`,zh:`${en}：${zh}`,de:`${en}: ${de}`,fr:`${en} : ${fr}`},
      example:{en:`Use “${en}” in this sense.`,zh:`“${en}”在此处取这个词义。`,de:`„${en}“ wird hier in diesem Sinn verwendet.`,fr:`« ${en} » est employé ici dans ce sens.`}};
  }
  function buildCards(){
    const rows=window.LB4_ROWS||[];
    cards=rows.map(makeCard);
    $('#buildState').textContent = cards.length===10000 ? '10,000 张四语词义卡已就绪 · 首次打开后可离线使用' : `词库加载 ${cards.length}/10,000`;
    $('#startBtn').disabled = cards.length===0;
    renderHome();
  }
  function switchView(id){ $$('.view').forEach(v=>v.classList.toggle('active',v.id===id)); window.scrollTo({top:0,behavior:'instant'}); if(id==='browseView'){searchLimit=100;renderSearch();} if(id==='statsView') renderStats(); if(id==='settingsView') loadSettingsUI(); }
  function progressStats(){
    let seen=0, mastered=0, known=0;
    for(const p of Object.values(state.progress)){ if(p.reviews||p.known) seen++; if(p.mastered) mastered++; if(p.known) known++; }
    return {seen,mastered,known};
  }
  function dueCards(){ const now=Date.now(); return cards.filter(c=>{const p=state.progress[cardId(c)]; return p && !p.known && p.reviews>0 && p.due<=now;}).sort((a,b)=>state.progress[cardId(a)].due-state.progress[cardId(b)].due); }
  function newCards(){ const start=state.settings.startRank||2501; return cards.filter(c=>c.rank>=start && !(state.progress[cardId(c)]?.reviews) && !(state.progress[cardId(c)]?.known)).slice(0,state.settings.dailyNew); }
  function renderHome(){
    if(!cards.length) return;
    const d=dueCards(); const n=newCards(); const s=progressStats();
    $('#todayDue').textContent=Math.min(d.length,state.settings.reviewCap); $('#todayNew').textContent=n.length; $('#mastered').textContent=s.mastered;
  }
  function startStudy(){
    const due=dueCards().slice(0,state.settings.reviewCap), fresh=newCards(); queue=[...due,...fresh]; qi=0;
    if(!queue.length){ toast('今天没有到期复习或新词'); return; }
    switchView('studyView'); showCard();
  }
  function showCard(){
    current=queue[qi]; if(!current){ toast('今日学习完成'); switchView('homeView'); renderHome(); return; }
    $('#studyProgress').textContent=`${qi+1} / ${queue.length}`; $('#queueLabel').textContent=state.progress[cardId(current)]?.reviews?'到期复习':'新词'; $('#progressBar').style.width=`${(qi/queue.length)*100}%`;
    $('#wordEn').textContent=current.en; $('#bandBadge').textContent=current.band.label; $('#posBadge').textContent=`${current.pos} · ${current.level}`; $('#qualityBadge').textContent=current.quality==='curated'?'精修卡':'对齐卡';
    $('#answer').classList.add('hidden'); $('#revealBtn').classList.remove('hidden');
  }
  function reveal(){
    if(!current) return; const c=current;
    ['Zh','En','De','Fr'].forEach(k=>$('#meaning'+k).textContent=c.meaning[k.toLowerCase()]);
    ['En','Zh','De','Fr'].forEach(k=>{ $('#phrase'+k).textContent=c.phrase[k.toLowerCase()]; $('#example'+k).textContent=c.example[k.toLowerCase()]; });
    $('#answer').classList.remove('hidden'); $('#revealBtn').classList.add('hidden');
  }
  function rate(kind){
    if(!current) return; const p=ensureP(current), old=Math.max(0,p.interval||0); let days=0;
    if(kind==='again'){ p.streak=0; p.reps=Math.max(0,p.reps-1); days=0.007; }
    if(kind==='hard'){ p.streak+=1; p.reps+=1; days=old?Math.max(1,old*1.35):1; }
    if(kind==='good'){ p.streak+=1; p.reps+=1; days=old?Math.max(2,old*2.35):2; }
    if(kind==='easy'){ p.streak+=1; p.reps+=1; days=old?Math.max(4,old*3.2):4; }
    p.interval=Math.round(days*100)/100; p.last=Date.now(); p.due=Date.now()+days*DAY; p.reviews+=1; state.reviews=(state.reviews||0)+1;
    p.mastered=p.reps>=state.settings.masterReps && p.streak>=3 && p.interval>=state.settings.masterDays;
    saveState(); qi++; showCard();
  }
  function markKnown(c=current){ if(!c)return; const p=ensureP(c); p.known=true; p.mastered=true; p.last=Date.now(); saveState(); if(c===current){qi++;showCard();} renderHome(); }
  function markFoundation(){
    let n=0; for(const c of cards){ if(c.rank>2500) break; const p=ensureP(c); if(!p.known){p.known=true;p.mastered=true;n++;} } saveState(); renderHome(); toast(`已将 ${n} 个核心词标记为已会`);
  }
  function renderSearch(){
    const q=$('#searchInput').value.trim().toLocaleLowerCase();
    let arr=cards.filter(c=>activeBand==='all'||c.band.id===activeBand);
    if(q) arr=arr.filter(c=>[c.en,c.meaning.en,c.meaning.zh,c.meaning.de,c.meaning.fr].some(x=>String(x).toLocaleLowerCase().includes(q)));
    const total=arr.length, visible=arr.slice(0,searchLimit), box=$('#searchResults');
    if(!total){ box.innerHTML='<div class="empty">没有匹配结果</div>'; return; }
    const summary=`<div class="buildState" style="margin:2px 0 4px">共 ${total.toLocaleString()} 个结果 · 已显示 ${visible.length.toLocaleString()}</div>`;
    const list=visible.map(c=>`<article class="resultCard"><div><span class="rank">#${c.rank}</span><b>${esc(c.en)}</b><small>${esc(c.pos)} · ${esc(c.level)} · ${esc(c.band.label)}</small></div><div class="langs"><span>中 ${esc(c.meaning.zh)}</span><span>DE ${esc(c.meaning.de)}</span><span>FR ${esc(c.meaning.fr)}</span></div></article>`).join('');
    const more=visible.length<total?`<button class="secondary full" id="loadMoreBtn" style="margin:8px 0 24px">继续加载（剩余 ${(total-visible.length).toLocaleString()}）</button>`:'';
    box.innerHTML=summary+list+more;
    $('#loadMoreBtn')?.addEventListener('click',()=>{searchLimit=Math.min(total,searchLimit+100);renderSearch();});
  }
  function renderStats(){
    const s=progressStats(); $('#statSeen').textContent=s.seen; $('#statMastered').textContent=s.mastered; $('#statReviews').textContent=state.reviews||0; $('#statKnown').textContent=s.known;
    const base=today(), bins=Array(7).fill(0); for(const p of Object.values(state.progress)){ if(p.known||!p.due)continue; const d=Math.floor((p.due-base)/DAY); if(d>=0&&d<7)bins[d]++; }
    const max=Math.max(1,...bins); $('#forecast').innerHTML=bins.map((n,i)=>`<div><i style="height:${Math.max(5,n/max*100)}%"></i><b>${n}</b><span>${i===0?'今天':`+${i}天`}</span></div>`).join('');
  }
  function loadSettingsUI(){ $('#dailyNew').value=state.settings.dailyNew; $('#reviewCap').value=state.settings.reviewCap; $('#startBand').value=String(state.settings.startRank); $('#masterReps').value=state.settings.masterReps; $('#masterDays').value=state.settings.masterDays; }
  function saveSettingsUI(){
    state.settings.dailyNew=clamp($('#dailyNew').value,0,100); state.settings.reviewCap=clamp($('#reviewCap').value,10,500); state.settings.startRank=+$('#startBand').value; state.settings.masterReps=clamp($('#masterReps').value,3,20); state.settings.masterDays=clamp($('#masterDays').value,14,180); saveState(); renderHome(); toast('设置已保存');
  }
  function clamp(v,a,b){v=parseInt(v,10);return Number.isFinite(v)?Math.min(b,Math.max(a,v)):a;}
  function speak(target,lang){ const text=$('#'+target)?.textContent.trim(); if(!text||!('speechSynthesis'in window)) return; speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.lang=lang; speechSynthesis.speak(u); }
  function exportData(){ const blob=new Blob([JSON.stringify({app:'LexiBridge4',exportedAt:new Date().toISOString(),state},null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`LexiBridge4_backup_${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
  async function importData(file){ try{ const d=JSON.parse(await file.text()); if(!d?.state?.progress)throw 0; state={...defaultState(),...d.state,settings:{...defaultState().settings,...d.state.settings}}; saveState(); renderHome(); toast('备份已导入'); }catch{toast('备份文件无效');} }
  function applyTheme(){ const mode=state.settings.theme; document.documentElement.dataset.theme=mode==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):mode; }
  function toggleTheme(){ const cur=document.documentElement.dataset.theme; state.settings.theme=cur==='dark'?'light':'dark'; saveState(); applyTheme(); }
  function bind(){
    $$('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $('#startBtn').addEventListener('click',startStudy); $('#revealBtn').addEventListener('click',reveal); $('#endStudy').addEventListener('click',()=>{switchView('homeView');renderHome();});
    $$('.rating button').forEach(b=>b.addEventListener('click',()=>rate(b.dataset.rate))); $('#knownCurrent').addEventListener('click',()=>markKnown()); $('#quickKnown').addEventListener('click',markFoundation);
    $('#searchInput').addEventListener('input',()=>{searchLimit=100;renderSearch();}); $$('.chip').forEach(b=>b.addEventListener('click',()=>{activeBand=b.dataset.band;searchLimit=100;$$('.chip').forEach(x=>x.classList.toggle('active',x===b));renderSearch();}));
    $('#saveSettings').addEventListener('click',saveSettingsUI); $('#exportBtn').addEventListener('click',exportData); $('#importInput').addEventListener('change',e=>e.target.files[0]&&importData(e.target.files[0]));
    $('#resetBtn').addEventListener('click',()=>{if(confirm('确定清空所有学习记录？词库不会删除。')){state=defaultState();saveState();applyTheme();renderHome();toast('学习记录已清空');}});
    $('#themeBtn').addEventListener('click',toggleTheme); $$('[data-target][data-lang]').forEach(b=>b.addEventListener('click',()=>speak(b.dataset.target,b.dataset.lang)));
  }
  function registerSW(){ if('serviceWorker'in navigator && location.protocol==='https:') navigator.serviceWorker.register('./sw.js').catch(()=>{}); }
  function init(){ applyTheme(); bind(); buildCards(); switchView('homeView'); registerSW(); }
  document.addEventListener('DOMContentLoaded',init);
})();
