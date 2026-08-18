(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const DAY = 86400000;
const POS = ['noun','verb','adjective','adverb','phrase'];
const POS_ZH = {noun:'名词',verb:'动词',adjective:'形容词',adverb:'副词',phrase:'短语',word:'词'};
const LEVEL = ['A1','A2','B1','B2','C1','C2'];
const STORE = 'lexibridge4_state_v3';
const OLD_STORE = 'lexibridge4_state_v2';
const BAND = rank => rank <= 2500 ? ['core','核心 1–2500'] : rank <= 5000 ? ['upper','中高级 2501–5000'] : rank <= 8000 ? ['academic','学术 5001–8000'] : ['advanced','高级 8001–10000'];
const defaultState = () => ({version:3,settings:{dailyNew:12,reviewCap:120,startRank:2501,masterReps:5,masterDays:30,pageSize:40,theme:'system'},progress:{},reviews:0});
let state = loadState();
let cards = [], byRank = new Map(), queue = [], qi = 0, current = null, detailCard = null;
let filters = {band:'all',status:'all',pos:'all',sort:'relevance',q:'',page:1};

function loadState(){
  try{
    const raw = localStorage.getItem(STORE) || localStorage.getItem(OLD_STORE);
    if(!raw) return defaultState();
    const x = JSON.parse(raw); const d=defaultState();
    const out={...d,...x,version:3,settings:{...d.settings,...(x.settings||{})},progress:x.progress||{}};
    localStorage.setItem(STORE,JSON.stringify(out));
    return out;
  }catch{return defaultState();}
}
function saveState(){localStorage.setItem(STORE,JSON.stringify(state));}
function toast(msg,ms=1800){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._tm);t._tm=setTimeout(()=>t.classList.remove('show'),ms);}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function normalize(s=''){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().trim();}
function cardId(c){return `${c.en}-${c.pos}-${c.synset||c.rank}`;}
function ensureP(c){const id=cardId(c);return state.progress[id] ||= {reps:0,streak:0,interval:0,due:0,reviews:0,known:false,mastered:false,favorite:false,foundation:false,last:0};}
function getP(c){return state.progress[cardId(c)]||null;}
function cleanArr(x){return Array.isArray(x)?x.filter(Boolean).map(String):[];}

function makeCard(r,idx){
  const rank=idx+1,[bandId,bandLabel]=BAND(rank),pos=typeof r[1]==='number'?(POS[r[1]]||'word'):String(r[1]||'word');
  const c={en:String(r[0]||''),pos,level:LEVEL[r[2]]||'C1',topic:(window.LB4_TOPICS||[])[r[3]]||'通用',meaning:{en:String(r[4]||''),zh:String(r[5]||''),de:String(r[6]||''),fr:String(r[7]||'')},rank,frequencyRank:r[8]??null,frequencyCount:r[9]??null,synset:String(r[10]||rank),quality:Number(r[11]||0),band:{id:bandId,label:bandLabel},naturalExample:{en:String(r[12]||''),zh:String(r[13]||''),de:String(r[14]||''),fr:String(r[15]||'')},related:{en:cleanArr(r[16]),zh:cleanArr(r[17]),de:cleanArr(r[18]),fr:cleanArr(r[19])}};
  c.searchText=normalize([c.en,c.meaning.en,c.meaning.zh,c.meaning.de,c.meaning.fr,...c.related.en,...c.related.zh,...c.related.de,...c.related.fr].join(' '));
  return c;
}
function buildCards(){
  const rows=window.LB4_ROWS||[];cards=rows.map(makeCard);byRank=new Map(cards.map(c=>[c.rank,c]));
  const strict=cards.filter(c=>c.quality>=2).length;
  $('#buildState').textContent=cards.length===10000?`10,000 张词卡已载入 · ${strict===10000?'四语严格同概念对齐':'词库质量升级中'}`:`词库加载 ${cards.length.toLocaleString()}/10,000`;
  $('#qualitySummary').textContent=strict===10000?'当前 10,000 张卡均绑定同一 WordNet/ILI 概念的中英德法对应；自然例句优先，缺失时明确标注结构化语境。':'当前网页功能已升级；词库正在替换为严格同概念四语版本。';
  $('#startBtn').disabled=!cards.length;renderHome();
}

function statusOf(c){const p=getP(c);if(!p)return'new';if(p.known)return'known';if(p.mastered)return'mastered';if(p.reviews>0&&p.due&&p.due<=Date.now())return'due';if(p.reviews>0)return'learning';return'new';}
function statusLabel(c){return {new:'未学习',learning:'学习中',due:'到期',mastered:'已掌握',known:'原本已会'}[statusOf(c)]||'未学习';}
function progressStats(){let seen=0,mastered=0,known=0,learning=0;for(const p of Object.values(state.progress)){if(p.reviews||p.known)seen++;if(p.mastered)mastered++;if(p.known)known++;if(p.reviews>0&&!p.mastered&&!p.known)learning++;}return{seen,mastered,known,learning};}
function dueCards(){const now=Date.now();return cards.filter(c=>{const p=getP(c);return p&&!p.known&&p.reviews>0&&p.due<=now;}).sort((a,b)=>getP(a).due-getP(b).due);}
function newCards(limit=state.settings.dailyNew){const start=state.settings.startRank||2501;return cards.filter(c=>{const p=getP(c);return c.rank>=start&&!(p?.reviews>0)&&!p?.known&&!p?.mastered;}).slice(0,limit);}
function renderHome(){if(!cards.length)return;const s=progressStats(),d=dueCards();$('#todayDue').textContent=Math.min(d.length,state.settings.reviewCap);$('#todayNew').textContent=newCards().length;$('#mastered').textContent=s.mastered;$('#learningCount').textContent=s.learning;}

function switchView(id){$$('.view').forEach(v=>v.classList.toggle('active',v.id===id));window.scrollTo({top:0,behavior:'instant'});if(id==='browseView')renderSearch();if(id==='statsView')renderStats();if(id==='settingsView')loadSettingsUI();}
function openStatus(status){filters.status=status;filters.page=1;$('#statusFilter').value=status;switchView('browseView');}

function startStudy(){const due=dueCards().slice(0,state.settings.reviewCap),fresh=newCards();queue=[...due,...fresh];qi=0;if(!queue.length){toast('今天没有到期复习或新词');return;}switchView('studyView');showStudyCard();}
function showStudyCard(){current=queue[qi];if(!current){toast('今日学习完成');switchView('homeView');renderHome();return;}const p=getP(current);$('#studyProgress').textContent=`${qi+1} / ${queue.length}`;$('#queueLabel').textContent=p?.reviews?'到期复习':'新词';$('#progressBar').style.width=`${Math.round(qi/queue.length*100)}%`;$('#studyWord').textContent=current.en;$('#bandBadge').textContent=current.band.label;$('#posBadge').textContent=`${POS_ZH[current.pos]||current.pos} · ${current.level}`;$('#qualityBadge').textContent=current.quality>=2?'严格同概念':'待升级对齐';$('#statusBadge').textContent=statusLabel(current);$('#answer').classList.add('hidden');$('#revealBtn').classList.remove('hidden');}
function meaningHTML(c){return [['中文','zh','zh-CN'],['English','en','en-US'],['Deutsch','de','de-DE'],['Français','fr','fr-FR']].map(([label,k,lang])=>`<div class="meaningBox"><header><label>${label}</label>${k==='zh'?'':`<button class="miniSpeak dynSpeak" type="button" data-speak="${esc(c.meaning[k])}" data-lang="${lang}">🔊</button>`}</header><p>${esc(c.meaning[k])}</p></div>`).join('');}
function structuredExamples(c){
  const m=c.meaning,p=c.pos;
  if(p==='verb')return{en:`In a controlled context, researchers may need to ${c.en} the material or process.`,zh:`在受控情境中，研究人员可能需要${m.zh}相关材料或过程。`,de:`In einem kontrollierten Kontext versuchen Fachleute, den Vorgang zu ${m.de}.`,fr:`Dans un contexte contrôlé, les spécialistes peuvent chercher à ${m.fr} le processus.`};
  if(p==='adjective')return{en:`The researchers described the result as ${c.en}.`,zh:`研究人员将这一结果描述为“${m.zh}”。`,de:`Die Forschenden beschrieben das Ergebnis als „${m.de}“.`,fr:`Les chercheurs ont décrit le résultat comme « ${m.fr} ».`};
  if(p==='adverb')return{en:`The process was carried out ${c.en} in the reported case.`,zh:`在所报告的案例中，该过程以“${m.zh}”所表达的方式进行。`,de:`Im beschriebenen Fall wurde der Vorgang ${m.de} durchgeführt.`,fr:`Dans le cas décrit, le processus a été réalisé ${m.fr}.`};
  return{en:`The study discusses ${c.en} as an important concept in this context.`,zh:`这项研究把“${m.zh}”作为该语境中的一个重要概念进行讨论。`,de:`Die Studie behandelt „${m.de}“ als einen wichtigen Begriff in diesem Zusammenhang.`,fr:`L’étude examine « ${m.fr} » comme une notion importante dans ce contexte.`};
}
function usageFrames(c){
  const m=c.meaning,p=c.pos,rel=c.related;
  const frame={en:[],zh:[],de:[],fr:[]};
  if(p==='verb'){frame.en=[`to ${c.en} something`,`${c.en} a process`];frame.zh=[`${m.zh}某事物`,`${m.zh}一个过程`];frame.de=[`etwas ${m.de}`,`einen Vorgang ${m.de}`];frame.fr=[`${m.fr} quelque chose`,`${m.fr} un processus`];}
  else if(p==='adjective'){frame.en=[`${c.en} result`,`${c.en} condition`];frame.zh=[`${m.zh}的结果`,`${m.zh}的状态`];frame.de=[`${m.de}es Ergebnis`,`als ${m.de} beschreiben`];frame.fr=[`résultat ${m.fr}`,`décrire comme ${m.fr}`];}
  else if(p==='adverb'){frame.en=[`${c.en} expressed`,`${c.en} applied`];frame.zh=[`${m.zh}地表达`,`${m.zh}地应用`];frame.de=[`${m.de} ausdrücken`,`${m.de} anwenden`];frame.fr=[`exprimer ${m.fr}`,`appliquer ${m.fr}`];}
  else{frame.en=[`${c.en} in context`,`a case of ${c.en}`];frame.zh=[`${m.zh}现象`,`关于${m.zh}的案例`];frame.de=[`${m.de} im Kontext`,`ein Fall von ${m.de}`];frame.fr=[`${m.fr} en contexte`,`un cas de ${m.fr}`];}
  for(const k of ['en','zh','de','fr'])frame[k]=[...(rel[k]||[]).slice(0,3),...frame[k]].filter(Boolean).slice(0,4);
  return frame;
}
function contentBundle(c){const fallback=structuredExamples(c),examples={},natural=[];for(const k of ['en','zh','de','fr']){examples[k]=c.naturalExample[k]||fallback[k];if(c.naturalExample[k])natural.push(k);}return{phrases:usageFrames(c),examples,usageSource:c.related.en.length||c.related.zh.length||c.related.de.length||c.related.fr.length?'词网相关表达 + 用法框架':'结构化用法框架',exampleSource:natural.length===4?'四语词网自然例句':natural.length?`词网自然例句：${natural.map(x=>x.toUpperCase()).join(' / ')}；其余为结构化语境`:'结构化语境（非人工例句）'};}
function quadHTML(obj){return [['EN','en'],['中','zh'],['DE','de'],['FR','fr']].map(([label,k])=>`<div class="quadItem"><b>${label}</b><span>${Array.isArray(obj[k])?obj[k].map(esc).join(' · '):esc(obj[k])}</span></div>`).join('');}
function bindDynamicSpeech(root=document){root.querySelectorAll('.dynSpeak').forEach(b=>b.onclick=()=>speakText(b.dataset.speak,b.dataset.lang));}
function reveal(){if(!current)return;const x=contentBundle(current);$('#studyMeaningGrid').innerHTML=meaningHTML(current);$('#studyPhrases').innerHTML=quadHTML(x.phrases);$('#studyExamples').innerHTML=quadHTML(x.examples);$('#studyUsageSource').textContent=x.usageSource;$('#studyExampleSource').textContent=x.exampleSource;$('#answer').classList.remove('hidden');$('#revealBtn').classList.add('hidden');bindDynamicSpeech($('#answer'));}
function rate(kind){if(!current)return;const p=ensureP(current),old=Math.max(0,p.interval||0);let days=0;if(kind==='again'){p.streak=0;p.reps=Math.max(0,p.reps-1);days=10/(60*24);}else if(kind==='hard'){p.streak++;p.reps++;days=old?Math.max(1,old*1.35):1;}else if(kind==='good'){p.streak++;p.reps++;days=old?Math.max(2,old*2.35):2;}else{p.streak++;p.reps++;days=old?Math.max(4,old*3.2):4;}p.known=false;p.foundation=false;p.interval=Math.round(days*100)/100;p.last=Date.now();p.due=Date.now()+days*DAY;p.reviews++;state.reviews=(state.reviews||0)+1;p.mastered=p.reps>=state.settings.masterReps&&p.streak>=3&&p.interval>=state.settings.masterDays;saveState();qi++;showStudyCard();renderHome();}
function markKnown(c=current,foundation=false){if(!c)return;const p=ensureP(c);p.known=true;p.mastered=true;p.foundation=foundation;p.last=Date.now();p.due=0;saveState();renderHome();if(c===current){qi++;showStudyCard();}if(detailCard===c)renderDetail(c);}

function morphCandidates(q){const w=normalize(q),s=new Set([w]);if(!/^[a-z'-]+$/.test(w))return s;if(w.endsWith('ied')&&w.length>4)s.add(w.slice(0,-3)+'y');if(w.endsWith('ies')&&w.length>4)s.add(w.slice(0,-3)+'y');if(w.endsWith('ed')&&w.length>4){const stem=w.slice(0,-2);s.add(stem);s.add(stem+'e');if(stem.length>2&&stem.at(-1)===stem.at(-2))s.add(stem.slice(0,-1));}if(w.endsWith('ing')&&w.length>5){const stem=w.slice(0,-3);s.add(stem);s.add(stem+'e');if(stem.length>2&&stem.at(-1)===stem.at(-2))s.add(stem.slice(0,-1));}if(w.endsWith('es')&&w.length>4){s.add(w.slice(0,-2));s.add(w.slice(0,-1));}if(w.endsWith('s')&&w.length>3)s.add(w.slice(0,-1));return s;}
function levenshtein(a,b,max=2){if(Math.abs(a.length-b.length)>max)return max+1;let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const cur=[i];let rowMin=i;for(let j=1;j<=b.length;j++){cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));rowMin=Math.min(rowMin,cur[j]);}if(rowMin>max)return max+1;prev=cur;}return prev[b.length];}
function scoreCard(c,q){if(!q)return 0;const nq=normalize(q),en=normalize(c.en),morph=morphCandidates(nq);if(en===nq)return 0;if(morph.has(en))return 4;if(en.startsWith(nq))return 10;if(nq.startsWith(en))return 14;if(en.includes(nq))return 20;for(const x of [c.meaning.zh,c.meaning.de,c.meaning.fr]){const n=normalize(x);if(n===nq)return 24;if(n.startsWith(nq))return 28;if(n.includes(nq))return 36;}if(normalize(c.meaning.en).includes(nq))return 42;if(c.searchText.includes(nq))return 50;if(nq.length>=4){const d=levenshtein(en,nq,2);if(d<=2)return 70+d;}return Infinity;}
function statusMatch(c,status){const p=getP(c),st=statusOf(c);if(status==='all')return true;if(status==='favorite')return !!p?.favorite;if(status==='new')return st==='new';if(status==='learning')return st==='learning';if(status==='due')return st==='due';if(status==='mastered')return st==='mastered'||st==='known';if(status==='known')return st==='known';return true;}
function filteredCards(){const q=filters.q;let arr=[];for(const c of cards){if(filters.band!=='all'&&c.band.id!==filters.band)continue;if(filters.pos!=='all'&&c.pos!==filters.pos)continue;if(!statusMatch(c,filters.status))continue;const score=scoreCard(c,q);if(score===Infinity)continue;arr.push({c,score});}if(filters.sort==='alpha')arr.sort((a,b)=>a.c.en.localeCompare(b.c.en));else if(filters.sort==='recent')arr.sort((a,b)=>(getP(b.c)?.last||0)-(getP(a.c)?.last||0)||a.c.rank-b.c.rank);else if(filters.sort==='rank')arr.sort((a,b)=>a.c.rank-b.c.rank);else arr.sort((a,b)=>a.score-b.score||a.c.rank-b.c.rank);return arr.map(x=>x.c);}
function renderSearch(){if(!cards.length)return;filters.q=$('#searchInput').value.trim();filters.status=$('#statusFilter').value;filters.pos=$('#posFilter').value;filters.sort=$('#sortFilter').value;const arr=filteredCards(),size=Number(state.settings.pageSize)||40,pages=Math.max(1,Math.ceil(arr.length/size));filters.page=Math.min(Math.max(1,filters.page),pages);const start=(filters.page-1)*size,visible=arr.slice(start,start+size);$('#resultSummary').textContent=`共 ${arr.length.toLocaleString()} 个结果 · 显示 ${arr.length?start+1:0}–${Math.min(start+size,arr.length)}`;$('#pageInfo').textContent=`第 ${filters.page} / ${pages} 页`;$('#prevPage').disabled=filters.page<=1;$('#nextPage').disabled=filters.page>=pages;$('#pager').classList.toggle('hidden',arr.length===0);$('#searchResults').innerHTML=visible.length?visible.map(resultHTML).join(''):'<div class="empty">没有匹配结果</div>';$$('.resultCard').forEach(b=>b.onclick=()=>openDetail(byRank.get(Number(b.dataset.rank))));}
function resultHTML(c){const p=getP(c),st=statusOf(c),usage=usageFrames(c).en.slice(0,2).join(' · ');return `<button class="resultCard" type="button" data-rank="${c.rank}"><div class="resultTop"><div class="resultTitle"><span class="rank">#${c.rank}</span><strong>${esc(c.en)}</strong>${p?.favorite?'<span>★</span>':''}</div><div class="resultMetaLine"><span>${esc(POS_ZH[c.pos]||c.pos)}</span><span>${esc(c.level)}</span><span>${esc(c.band.label)}</span><span class="statusPill ${st==='mastered'||st==='known'?'good':st==='due'?'warn':''}">${statusLabel(c)}</span></div><small class="phrasePreview">${esc(usage)}</small></div><div class="langs"><span>中 ${esc(c.meaning.zh)}</span><span>DE ${esc(c.meaning.de)}</span><span>FR ${esc(c.meaning.fr)}</span></div></button>`;}
function resetBrowse(){filters={band:'all',status:'all',pos:'all',sort:'relevance',q:'',page:1};$('#searchInput').value='';$('#statusFilter').value='all';$('#posFilter').value='all';$('#sortFilter').value='relevance';$$('.chip').forEach(b=>b.classList.toggle('active',b.dataset.band==='all'));renderSearch();}

function renderDetail(c){if(!c)return;detailCard=c;const p=getP(c),x=contentBundle(c);$('#detailWord').textContent=c.en;$('#favoriteBtn').textContent=p?.favorite?'★':'☆';$('#detailBadges').innerHTML=`<span>#${c.rank}</span><span>${esc(POS_ZH[c.pos]||c.pos)} · ${esc(c.level)}</span><span>${esc(c.band.label)}</span><span>${c.quality>=2?'严格同概念':'待升级对齐'}</span><span>${statusLabel(c)}</span>`;$('#detailMeaningGrid').innerHTML=meaningHTML(c);$('#detailPhrases').innerHTML=quadHTML(x.phrases);$('#detailExamples').innerHTML=quadHTML(x.examples);$('#detailUsageSource').textContent=x.usageSource;$('#detailExampleSource').textContent=x.exampleSource;$('#detailProgress').innerHTML=progressHTML(c);$('#detailKnownBtn').textContent=p?.known?'撤销“原本已会”':'标记原本已会';$('#detailRelearnBtn').textContent=p?.mastered||p?.known?'重新加入复习':'加入今日复习';$('#detailBackdrop').classList.remove('hidden');document.body.style.overflow='hidden';bindDynamicSpeech($('#detailBackdrop'));}
function closeDetail(){detailCard=null;$('#detailBackdrop').classList.add('hidden');document.body.style.overflow='';}
function progressHTML(c){const p=getP(c);if(!p)return'<p class="settingNote">尚未学习。你可以标记已会，或加入复习。</p>';const due=p.due?new Date(p.due).toLocaleString():'—';return `<div class="progressFacts"><div><b>${p.reviews||0}</b><span>复习次数</span></div><div><b>${p.streak||0}</b><span>连续成功</span></div><div><b>${p.interval||0}d</b><span>当前间隔</span></div></div><p class="settingNote">状态：${statusLabel(c)} · 下次到期：${esc(due)}</p>`;}
function toggleFavorite(){if(!detailCard)return;const p=ensureP(detailCard);p.favorite=!p.favorite;saveState();renderDetail(detailCard);renderSearch();}
function toggleDetailKnown(){if(!detailCard)return;const p=ensureP(detailCard);if(p.known){p.known=false;p.mastered=p.reviews>0&&p.reps>=state.settings.masterReps&&p.streak>=3&&p.interval>=state.settings.masterDays;p.foundation=false;}else{p.known=true;p.mastered=true;p.foundation=false;p.last=Date.now();p.due=0;}saveState();renderDetail(detailCard);renderHome();renderSearch();}
function relearnDetail(){if(!detailCard)return;const p=ensureP(detailCard);p.known=false;p.mastered=false;p.foundation=false;p.reviews=Math.max(1,p.reviews||0);p.due=Date.now();p.last=Date.now();saveState();renderDetail(detailCard);renderHome();renderSearch();toast('已加入到期复习队列');}
function resetDetail(){if(!detailCard)return;if(!confirm(`重置 “${detailCard.en}” 的学习记录？`))return;delete state.progress[cardId(detailCard)];saveState();renderDetail(detailCard);renderHome();renderSearch();toast('该词学习记录已重置');}

function renderStats(){const s=progressStats();$('#statSeen').textContent=s.seen;$('#statMastered').textContent=s.mastered;$('#statReviews').textContent=state.reviews||0;$('#statKnown').textContent=s.known;const base=new Date();base.setHours(0,0,0,0);const bins=Array(7).fill(0);for(const p of Object.values(state.progress)){if(p.known||!p.due)continue;const d=Math.floor((p.due-base.getTime())/DAY);if(d>=0&&d<7)bins[d]++;}const max=Math.max(1,...bins);$('#forecast').innerHTML=bins.map((n,i)=>`<div><i style="height:${Math.max(5,n/max*100)}%"></i><b>${n}</b><span>${i===0?'今天':`+${i}天`}</span></div>`).join('');const recent=cards.filter(c=>getP(c)?.last).sort((a,b)=>getP(b).last-getP(a).last).slice(0,8);$('#recentList').innerHTML=recent.length?recent.map(c=>`<button class="miniItem" type="button" data-rank="${c.rank}"><b>${esc(c.en)}</b><span>${statusLabel(c)} · ${new Date(getP(c).last).toLocaleDateString()}</span></button>`).join(''):'<div class="empty">还没有学习记录</div>';$$('#recentList .miniItem').forEach(b=>b.onclick=()=>openDetail(byRank.get(Number(b.dataset.rank))));}
function loadSettingsUI(){const s=state.settings;$('#dailyNew').value=s.dailyNew;$('#reviewCap').value=s.reviewCap;$('#startBand').value=String(s.startRank);$('#masterReps').value=s.masterReps;$('#masterDays').value=s.masterDays;$('#pageSize').value=String(s.pageSize||40);const any=Object.values(state.progress).some(p=>p.foundation);$('#foundationToggle').textContent=any?'撤销核心 2,500 词“已会”标记':'将核心 2,500 词标记为已会';}
function clamp(v,a,b){v=parseInt(v,10);return Number.isFinite(v)?Math.min(b,Math.max(a,v)):a;}
function saveSettingsUI(){state.settings.dailyNew=clamp($('#dailyNew').value,0,100);state.settings.reviewCap=clamp($('#reviewCap').value,10,500);state.settings.startRank=Number($('#startBand').value);state.settings.masterReps=clamp($('#masterReps').value,3,20);state.settings.masterDays=clamp($('#masterDays').value,14,180);state.settings.pageSize=Number($('#pageSize').value)||40;saveState();renderHome();toast('设置已保存');}
function foundationToggle(){const reverting=Object.values(state.progress).some(p=>p.foundation);let n=0;if(reverting){for(const c of cards.slice(0,2500)){const id=cardId(c),p=state.progress[id];if(!p?.foundation)continue;p.foundation=false;p.known=false;p.mastered=false;if(!p.reviews&&!p.favorite)delete state.progress[id];n++;}toast(`已撤销 ${n} 个基础词标记`);}else{for(const c of cards.slice(0,2500)){const p=getP(c);if(p?.reviews||p?.known||p?.mastered)continue;const np=ensureP(c);np.known=true;np.mastered=true;np.foundation=true;np.last=Date.now();n++;}toast(`已标记 ${n} 个基础词为已会`);}saveState();loadSettingsUI();renderHome();}
function exportData(){const blob=new Blob([JSON.stringify({app:'LexiBridge4',schema:3,exportedAt:new Date().toISOString(),state},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`LexiBridge4_backup_${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function importData(file){try{const d=JSON.parse(await file.text());if(!d?.state?.progress)throw 0;const base=defaultState();state={...base,...d.state,version:3,settings:{...base.settings,...d.state.settings},progress:d.state.progress};saveState();renderHome();toast('备份已导入');}catch{toast('备份文件无效');}}
function resetAll(){if(!confirm('确定清空全部学习记录？词库不会删除。'))return;state=defaultState();saveState();applyTheme();renderHome();toast('学习记录已清空');}

function speakText(text,lang){if(!text||!('speechSynthesis'in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=lang;speechSynthesis.speak(u);}
function speakTarget(id,lang){speakText($('#'+id)?.textContent.trim(),lang);}
function applyTheme(){const mode=state.settings.theme;document.documentElement.dataset.theme=mode==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):mode;}
function toggleTheme(){state.settings.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';saveState();applyTheme();}
async function forceUpdate(){toast('正在刷新到最新版…',2500);try{const regs=await navigator.serviceWorker?.getRegistrations?.()||[];for(const r of regs)await r.update();const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('lexibridge4-')).map(k=>caches.delete(k)));}catch{}setTimeout(()=>location.replace(`${location.pathname}?v=${Date.now()}`),350);}
function registerSW(){if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js?v=6').catch(()=>{});}

function bind(){
  $$('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));$$('[data-open-status]').forEach(b=>b.onclick=()=>openStatus(b.dataset.openStatus));
  $('#startBtn').onclick=startStudy;$('#revealBtn').onclick=reveal;$('#endStudy').onclick=()=>{switchView('homeView');renderHome();};$$('.rating button').forEach(b=>b.onclick=()=>rate(b.dataset.rate));$('#knownCurrent').onclick=()=>markKnown();$('#openStudyDetail').onclick=()=>openDetail(current);
  $('#searchInput').oninput=()=>{filters.page=1;renderSearch();};$('#clearSearch').onclick=()=>{$('#searchInput').value='';filters.page=1;renderSearch();};$$('.chip').forEach(b=>b.onclick=()=>{filters.band=b.dataset.band;filters.page=1;$$('.chip').forEach(x=>x.classList.toggle('active',x===b));renderSearch();});for(const id of ['statusFilter','posFilter','sortFilter'])$('#'+id).onchange=()=>{filters.page=1;renderSearch();};$('#resetFilters').onclick=resetBrowse;
  $('#prevPage').onclick=()=>{filters.page=Math.max(1,filters.page-1);renderSearch();window.scrollTo({top:0,behavior:'smooth'});};$('#nextPage').onclick=()=>{filters.page++;renderSearch();window.scrollTo({top:0,behavior:'smooth'});};$('#pageInfo').onclick=()=>{const arr=filteredCards(),pages=Math.max(1,Math.ceil(arr.length/(state.settings.pageSize||40))),v=Number(prompt(`输入页码 1–${pages}`,filters.page));if(v>=1&&v<=pages){filters.page=v;renderSearch();}};$('#jumpRankBtn').onclick=()=>{const v=Number(prompt('输入词库序号 1–10000'));const c=byRank.get(v);if(c)openDetail(c);else toast('序号无效');};
  $('#closeDetail').onclick=closeDetail;$('#detailBackdrop').onclick=e=>{if(e.target===$('#detailBackdrop'))closeDetail();};$('#favoriteBtn').onclick=toggleFavorite;$('#speakGerman').onclick=()=>detailCard&&speakText(detailCard.meaning.de,'de-DE');$('#speakFrench').onclick=()=>detailCard&&speakText(detailCard.meaning.fr,'fr-FR');$('#detailKnownBtn').onclick=toggleDetailKnown;$('#detailRelearnBtn').onclick=relearnDetail;$('#detailResetBtn').onclick=resetDetail;
  $('#saveSettings').onclick=saveSettingsUI;$('#foundationToggle').onclick=foundationToggle;$('#exportBtn').onclick=exportData;$('#importInput').onchange=e=>e.target.files[0]&&importData(e.target.files[0]);$('#resetBtn').onclick=resetAll;$('#themeBtn').onclick=toggleTheme;$('#updateBtn').onclick=forceUpdate;$$('[data-target][data-lang]').forEach(b=>b.onclick=()=>speakTarget(b.dataset.target,b.dataset.lang));
}
function init(){applyTheme();bind();buildCards();switchView('homeView');registerSW();}
document.addEventListener('DOMContentLoaded',init);
})();