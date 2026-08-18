(() => {
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const DAY = 86_400_000;
const POS = ['noun','verb','adjective','adverb','phrase'];
const POS_ZH = {noun:'名词',verb:'动词',adjective:'形容词',adverb:'副词',phrase:'短语',word:'词'};
const LEVEL = ['A1','A2','B1','B2','C1','C2'];
const LANGS = ['en','de','fr'];
const LANG_META = {
  en:{name:'English',short:'EN',locale:'en-US',baseKey:'en'},
  de:{name:'Deutsch',short:'DE',locale:'de-DE',baseKey:'de'},
  fr:{name:'Français',short:'FR',locale:'fr-FR',baseKey:'fr'}
};
const STORE = 'lexibridge4_state_v5';
const LEGACY_STORES = ['lexibridge4_state_v4','lexibridge4_state_v3','lexibridge4_state_v2'];
const PACK_SCHEMA = 'lexibridge-rich-v1';
const DB_NAME = 'lexibridge4-rich-v1';
const DB_STORE = 'packs';
const BAND = (rank) => rank <= 2500 ? ['core','核心 1–2500'] : rank <= 5000 ? ['upper','中高级 2501–5000'] : rank <= 8000 ? ['academic','学术 5001–8000'] : ['advanced','高级 8001–10000'];

const defaultTrack = () => ({reps:0,streak:0,interval:0,due:0,reviews:0,mastered:false,known:false,last:0,recognitionSuccess:0,productionSuccess:0});
const defaultState = () => ({
  version:5,
  settings:{
    dailyNew:6,reviewCap:90,startRank:2501,languageMode:'all',directionMode:'adaptive',
    masterReps:5,masterDays:30,pageSize:40,theme:'system',
    aiModel:'claude-sonnet-4-6',autoAI:true,doublePass:true
  },
  progress:{},reviews:0,richIndex:[],lastCloudSync:0
});

let state = loadState();
let cards = [];
let byRank = new Map();
let byHead = new Map();
let queue = [];
let qi = 0;
let currentTask = null;
let detailCard = null;
let detailPack = null;
let filters = {band:'all',status:'all',pos:'all',sort:'relevance',q:'',page:1};
let packMemory = new Map();
let packPromises = new Map();
let dbPromise = null;
let cloudSaveTimer = null;

function loadState(){
  try{
    let raw = localStorage.getItem(STORE);
    if(!raw){
      for(const k of LEGACY_STORES){ raw = localStorage.getItem(k); if(raw) break; }
    }
    if(!raw) return defaultState();
    const x = JSON.parse(raw), d = defaultState();
    return {...d,...x,version:5,settings:{...d.settings,...(x.settings||{})},progress:x.progress||{},richIndex:Array.isArray(x.richIndex)?x.richIndex:[]};
  }catch{return defaultState();}
}
function saveState({cloud=true}={}){
  localStorage.setItem(STORE,JSON.stringify(state));
  if(cloud && isAiSignedIn()) scheduleCloudStateSave();
}
function toast(msg,ms=2200){
  const t=$('#toast'); if(!t) return;
  t.textContent=msg;t.classList.add('show');clearTimeout(t._tm);
  t._tm=setTimeout(()=>t.classList.remove('show'),ms);
}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function normalize(s=''){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().trim();}
function cleanArray(x){return Array.isArray(x)?x.filter(v=>v!==null&&v!==undefined&&String(v).trim()).map(v=>String(v).trim()):[];}
function uniqueStrings(arr){const out=[],seen=new Set();for(const x of cleanArray(arr)){const k=normalize(x);if(!seen.has(k)){seen.add(k);out.push(x);}}return out;}
function enabledLangs(){return state.settings.languageMode==='all'?LANGS:[state.settings.languageMode];}
function cardId(c){return `${c.en}-${c.pos}`;}
function packKey(c){return `${PACK_SCHEMA}:${cardId(c)}`;}
function hashKey(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
function cloudPackKey(c){return `lb4_pack_v1_${hashKey(packKey(c))}`;}
function newProgress(){return {favorite:false,foundation:false,tracks:{en:defaultTrack(),de:defaultTrack(),fr:defaultTrack()}};}
function cloneTrackFromLegacy(p){
  return {reps:Number(p.reps||0),streak:Number(p.streak||0),interval:Number(p.interval||0),due:Number(p.due||0),reviews:Number(p.reviews||0),mastered:!!p.mastered,known:!!p.known,last:Number(p.last||0),recognitionSuccess:Number(p.recognitionSuccess||0),productionSuccess:Number(p.productionSuccess||0)};
}
function ensureP(c){
  const id=cardId(c);
  let p=state.progress[id];
  if(!p){p=newProgress();state.progress[id]=p;}
  if(!p.tracks){
    const t=cloneTrackFromLegacy(p);
    p={favorite:!!p.favorite,foundation:!!p.foundation,tracks:{en:{...t},de:{...t},fr:{...t}}};
    state.progress[id]=p;
  }
  for(const lang of LANGS) p.tracks[lang] ||= defaultTrack();
  return p;
}
function getP(c){const p=state.progress[cardId(c)];if(!p)return null;if(!p.tracks)return ensureP(c);return p;}
function getTrack(c,lang){return ensureP(c).tracks[lang];}
function trackDone(t){return !!(t.known||t.mastered);}
function trackDue(t){return !trackDone(t)&&t.reviews>0&&t.due>0&&t.due<=Date.now();}
function cardStatus(c){
  const p=getP(c), langs=enabledLangs();
  if(!p)return'new';
  const ts=langs.map(l=>p.tracks[l]);
  if(ts.every(trackDone))return'mastered';
  if(ts.some(trackDue))return'due';
  if(ts.some(t=>t.reviews>0||t.known||t.mastered))return ts.some(trackDone)?'partial':'learning';
  return'new';
}
function statusLabel(c){return {new:'未学习',learning:'学习中',due:'有到期任务',partial:'部分语言已掌握',mastered:'三语已掌握'}[cardStatus(c)]||'未学习';}

const SEED_PACKS = {
  'contaminate-verb': {
    schema:PACK_SCHEMA,
    generatedAt:'2026-08-19T00:00:00Z',
    model:'editorial-seed',
    audit:{reviewed:true,passes:2,summaryZh:'人工结构示范包：所有行以同一语义功能进行英德法对照，避免逐字硬译。',warnings:[]},
    concept:{zh:'污染；使某物因有害物质、微生物或不纯成分而变得不安全或不洁',domain:'环境、医学、实验室',senseNoteZh:'主要学习及物动词义。日常环境语境中英语 pollute、德语 verschmutzen、法语 polluer 更常指环境污染；contaminate / kontaminieren / contaminer 更强调有害物质、样品或交叉污染。'},
    headwords:{
      en:{word:'contaminate',pos:'verb',pronunciation:'/kənˈtæmɪneɪt/',grammar:'及物动词；通常接 water, soil, food, sample, surface 等宾语。',forms:[{label:'第三人称单数',form:'contaminates'},{label:'过去式',form:'contaminated'},{label:'过去分词',form:'contaminated'},{label:'现在分词',form:'contaminating'}],derivatives:[{word:'contamination',pos:'noun',zh:'污染；污染物进入的过程'},{word:'contaminant',pos:'noun',zh:'污染物'},{word:'contaminated',pos:'adjective',zh:'受污染的'},{word:'cross-contamination',pos:'noun',zh:'交叉污染'}]},
      de:{word:'kontaminieren / verunreinigen',pos:'Verb',pronunciation:'',grammar:'及物动词。kontaminieren 常用于医学、实验室和专业环境；verunreinigen 更通用。',forms:[{label:'第三人称单数',form:'kontaminiert'},{label:'过去时',form:'kontaminierte'},{label:'第二分词',form:'kontaminiert'},{label:'完成时',form:'hat kontaminiert'}],derivatives:[{word:'die Kontamination',pos:'Nomen',zh:'污染；沾染'},{word:'der Kontaminant',pos:'Nomen',zh:'污染物'},{word:'kontaminiert',pos:'Adjektiv',zh:'受污染的'},{word:'die Kreuzkontamination',pos:'Nomen',zh:'交叉污染'}]},
      fr:{word:'contaminer',pos:'verbe',pronunciation:'',grammar:'及物动词；可用于水、食品、样品、表面及人群受病原体污染。',forms:[{label:'直陈式现在时',form:'je contamine / il contamine'},{label:'未完成过去时',form:'contaminait'},{label:'复合过去时',form:'a contaminé'},{label:'过去分词',form:'contaminé(e)'}],derivatives:[{word:'la contamination',pos:'nom',zh:'污染；沾染'},{word:'un contaminant',pos:'nom',zh:'污染物'},{word:'contaminé(e)',pos:'adjectif',zh:'受污染的'},{word:'la contamination croisée',pos:'nom',zh:'交叉污染'}]}
    },
    families:[
      {functionZh:'表示“污染”这一动作',zh:'污染；使受污染',en:'contaminate',de:'kontaminieren / verunreinigen',fr:'contaminer',noteZh:'专业语境优先使用 kontaminieren；日常环境语境也常用 verschmutzen。'},
      {functionZh:'表示污染这一过程或状态',zh:'污染；沾染',en:'contamination',de:'die Kontamination / Verunreinigung',fr:'la contamination',noteZh:''},
      {functionZh:'表示造成污染的物质',zh:'污染物',en:'contaminant',de:'der Kontaminant / Schadstoff',fr:'un contaminant / polluant',noteZh:'Schadstoff / polluant 更强调有害污染物。'},
      {functionZh:'表示已经受到污染',zh:'受污染的',en:'contaminated',de:'kontaminiert / verunreinigt',fr:'contaminé(e)',noteZh:''},
      {functionZh:'表示不同来源之间的污染传播',zh:'交叉污染',en:'cross-contamination',de:'die Kreuzkontamination',fr:'la contamination croisée',noteZh:'食品安全和实验室中的高频术语。'}
    ],
    synonyms:[
      {nuanceZh:'环境被废物或化学物质污染',zh:'污染环境',en:'pollute',de:'verschmutzen',fr:'polluer',register:'通用',differenceZh:'比 contaminate 更常用于空气、河流、环境等大范围污染。'},
      {nuanceZh:'使纯度下降或混入不洁成分',zh:'使不纯；玷污',en:'taint',de:'verunreinigen',fr:'altérer / souiller',register:'通用／比喻',differenceZh:'taint 还可比喻名誉或品质受到玷污。'},
      {nuanceZh:'在食品或材料中掺入不应有的成分',zh:'掺杂；掺假',en:'adulterate',de:'verfälschen / versetzen',fr:'adultérer / frelater',register:'专业',differenceZh:'强调人为掺入低质或有害成分。'},
      {nuanceZh:'病原体使人或组织感染',zh:'感染',en:'infect',de:'infizieren',fr:'infecter',register:'医学',differenceZh:'infect 强调感染宿主，不可与所有 contaminate 语境互换。'}
    ],
    antonyms:[
      {nuanceZh:'移除污染物',zh:'去污',en:'decontaminate',de:'dekontaminieren',fr:'décontaminer',register:'专业',differenceZh:''},
      {nuanceZh:'使物质恢复洁净或纯净',zh:'净化',en:'purify',de:'reinigen',fr:'purifier',register:'通用',differenceZh:''},
      {nuanceZh:'使器械无菌',zh:'灭菌',en:'sterilize',de:'sterilisieren',fr:'stériliser',register:'医学／实验室',differenceZh:'只适用于消灭微生物的语境。'}
    ],
    collocations:[
      {functionZh:'污染饮用水',zh:'污染饮用水',en:'contaminate drinking water',de:'Trinkwasser verunreinigen',fr:"contaminer l'eau potable",register:'通用／环境',noteZh:''},
      {functionZh:'污染土壤',zh:'污染土壤',en:'contaminate the soil',de:'den Boden kontaminieren',fr:'contaminer le sol',register:'环境',noteZh:''},
      {functionZh:'污染食物',zh:'污染食品',en:'contaminate food',de:'Lebensmittel verunreinigen',fr:'contaminer des aliments',register:'食品安全',noteZh:''},
      {functionZh:'使实验样品受污染',zh:'污染样品',en:'contaminate a sample',de:'eine Probe kontaminieren',fr:'contaminer un échantillon',register:'实验室',noteZh:''},
      {functionZh:'细菌造成污染',zh:'被细菌污染',en:'be contaminated with bacteria',de:'mit Bakterien kontaminiert sein',fr:'être contaminé par des bactéries',register:'医学／食品',noteZh:'英语常用 with，法语常用 par。'},
      {functionZh:'化学物质造成污染',zh:'被化学物质污染',en:'be contaminated by chemicals',de:'durch Chemikalien verunreinigt sein',fr:'être contaminé par des produits chimiques',register:'环境／实验室',noteZh:''},
      {functionZh:'防止交叉污染',zh:'防止交叉污染',en:'prevent cross-contamination',de:'Kreuzkontamination vermeiden',fr:'éviter la contamination croisée',register:'食品／实验室',noteZh:'德法自然搭配通常用“避免”，不必逐字翻译 prevent。'},
      {functionZh:'污染源',zh:'污染源',en:'source of contamination',de:'Kontaminationsquelle',fr:'source de contamination',register:'通用／专业',noteZh:''},
      {functionZh:'污染风险',zh:'污染风险',en:'risk of contamination',de:'Kontaminationsrisiko',fr:'risque de contamination',register:'专业',noteZh:''},
      {functionZh:'严重污染',zh:'受到严重污染',en:'be heavily contaminated',de:'stark kontaminiert sein',fr:'être fortement contaminé',register:'通用',noteZh:''},
      {functionZh:'意外污染',zh:'意外造成污染',en:'accidentally contaminate',de:'versehentlich kontaminieren',fr:'contaminer accidentellement',register:'通用',noteZh:''},
      {functionZh:'检测污染',zh:'检测污染情况',en:'test for contamination',de:'auf Kontamination prüfen',fr:'rechercher une contamination',register:'实验室／医学',noteZh:'法语专业表达常用 rechercher。'}
    ],
    examples:[
      {scenarioZh:'饮用水安全',zh:'泄漏的燃料污染了附近村庄的饮用水。',en:'The leaking fuel contaminated the drinking water in the nearby village.',de:'Der ausgelaufene Treibstoff verunreinigte das Trinkwasser im nahe gelegenen Dorf.',fr:"Le carburant qui s'est échappé a contaminé l'eau potable du village voisin.",noteZh:'同一事件的自然平行表达。'},
      {scenarioZh:'实验室样品',zh:'技术员更换了手套，以免污染样品。',en:'The technician changed gloves to avoid contaminating the sample.',de:'Die Laborantin wechselte die Handschuhe, um die Probe nicht zu kontaminieren.',fr:"La technicienne a changé de gants pour éviter de contaminer l'échantillon.",noteZh:''},
      {scenarioZh:'食品安全',zh:'生鸡肉可能会使厨房表面受到细菌污染。',en:'Raw chicken can contaminate kitchen surfaces with bacteria.',de:'Rohes Hühnerfleisch kann Küchenoberflächen mit Bakterien kontaminieren.',fr:'Le poulet cru peut contaminer les surfaces de la cuisine avec des bactéries.',noteZh:''},
      {scenarioZh:'土壤修复',zh:'该工厂被指控用重金属污染周围土壤。',en:'The factory was accused of contaminating the surrounding soil with heavy metals.',de:'Der Fabrik wurde vorgeworfen, den umliegenden Boden mit Schwermetallen kontaminiert zu haben.',fr:"L'usine a été accusée d'avoir contaminé les sols environnants avec des métaux lourds.",noteZh:''},
      {scenarioZh:'医院控制感染',zh:'受污染的器械必须立即隔离并去污。',en:'Contaminated instruments must be isolated and decontaminated immediately.',de:'Kontaminierte Instrumente müssen sofort isoliert und dekontaminiert werden.',fr:'Les instruments contaminés doivent être isolés et décontaminés immédiatement.',noteZh:''},
      {scenarioZh:'研究质量',zh:'即使少量外来 DNA 也可能污染整个实验。',en:'Even a small amount of foreign DNA can contaminate the entire experiment.',de:'Schon eine geringe Menge fremder DNA kann das gesamte Experiment kontaminieren.',fr:"Même une petite quantité d'ADN étranger peut contaminer toute l'expérience.",noteZh:''}
    ],
    usageNotes:[
      {titleZh:'contaminate 与 pollute',detailZh:'contaminate 常强调某物因混入有害物、病原体或杂质而不再安全或纯净；pollute 更常用于空气、水体和环境受到大范围污染。',en:'contaminate a sample; pollute the atmosphere',de:'eine Probe kontaminieren; die Luft verschmutzen',fr:"contaminer un échantillon; polluer l'atmosphère"},
      {titleZh:'介词差异',detailZh:'英语常见 be contaminated with/by；德语常用 mit/durch；法语通常用 être contaminé par。',en:'contaminated with bacteria',de:'mit Bakterien kontaminiert',fr:'contaminé par des bactéries'},
      {titleZh:'避免硬译',detailZh:'“防止交叉污染”在德语和法语中自然表达通常是 Kreuzkontamination vermeiden / éviter la contamination croisée。',en:'prevent cross-contamination',de:'Kreuzkontamination vermeiden',fr:'éviter la contamination croisée'}
    ]
  }
};

function openDb(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    if(!('indexedDB'in window)){resolve(null);return;}
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE);};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  }).catch(()=>null);
  return dbPromise;
}
async function dbGet(key){
  const db=await openDb();if(!db)return null;
  return new Promise(resolve=>{
    const tx=db.transaction(DB_STORE,'readonly'),req=tx.objectStore(DB_STORE).get(key);
    req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>resolve(null);
  });
}
async function dbSet(key,value){
  const db=await openDb();if(!db)return false;
  return new Promise(resolve=>{
    const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put(value,key);
    tx.oncomplete=()=>resolve(true);tx.onerror=()=>resolve(false);
  });
}
async function dbDelete(key){
  const db=await openDb();if(!db)return false;
  return new Promise(resolve=>{
    const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete=()=>resolve(true);tx.onerror=()=>resolve(false);
  });
}
function isPuterReady(){return typeof window.puter==='object'&&window.puter?.ai?.chat;}
function isAiSignedIn(){try{return isPuterReady()&&window.puter.auth.isSignedIn();}catch{return false;}}
function setAiBusy(busy,label=''){
  const btn=$('#aiBtn');if(!btn)return;
  btn.classList.toggle('busy',busy);if(busy)btn.classList.remove('ready');
  if(label)$('#aiBtnText').textContent=label;else updateAiStatus();
}
async function updateAiStatus(){
  const btn=$('#aiBtn'),text=$('#aiBtnText');if(!btn||!text)return;
  if(!isPuterReady()){btn.classList.remove('ready','busy');text.textContent='AI 未载入';return;}
  if(isAiSignedIn()){
    btn.classList.add('ready');btn.classList.remove('busy');
    try{const u=await window.puter.auth.getUser();text.textContent=u?.username?`AI · ${u.username}`:'AI 已启用';}
    catch{text.textContent='AI 已启用';}
    const sign=$('#aiSignInBtn');if(sign)sign.textContent='Puter 已登录';
  }else{
    btn.classList.remove('ready','busy');text.textContent='启用 AI';
    const sign=$('#aiSignInBtn');if(sign)sign.textContent='登录 Puter 并启用 AI';
  }
}
async function ensureAiAuth(){
  if(!isPuterReady())throw new Error('Puter.js 未能载入，请检查网络后重试。');
  if(isAiSignedIn())return true;
  setAiBusy(true,'登录中');
  try{
    await window.puter.auth.signIn({attempt_temp_user_creation:true});
    await updateAiStatus();
    await pullCloudState().catch(()=>{});
    return true;
  }catch(err){
    updateAiStatus();
    throw new Error(err?.msg||err?.message||'未完成 AI 登录。');
  }
}
function scheduleCloudStateSave(){
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(()=>pushCloudState().catch(()=>{}),1500);
}
async function pushCloudState(){
  if(!isAiSignedIn()||!window.puter?.fs?.write)return false;
  const payload={...state,lastCloudSync:Date.now()};
  await window.puter.fs.write('LexiBridge4/state-v5.json',JSON.stringify(payload),{overwrite:true,createMissingParents:true});
  state.lastCloudSync=payload.lastCloudSync;
  localStorage.setItem(STORE,JSON.stringify(state));
  return true;
}
function mergeTrack(a,b){
  if(!a)return b||defaultTrack();if(!b)return a;
  const pick=(Number(b.last||0)>Number(a.last||0))?b:a;
  return {...defaultTrack(),...pick};
}
function mergeStates(local,cloud){
  const out={...defaultState(),...local,settings:{...defaultState().settings,...(cloud?.settings||{}),...(local?.settings||{})},progress:{...(cloud?.progress||{})},richIndex:uniqueStrings([...(cloud?.richIndex||[]),...(local?.richIndex||[])])};
  for(const [id,lpRaw] of Object.entries(local?.progress||{})){
    const cpRaw=out.progress[id];
    const lp=lpRaw?.tracks?lpRaw:{favorite:!!lpRaw?.favorite,foundation:!!lpRaw?.foundation,tracks:{en:cloneTrackFromLegacy(lpRaw||{}),de:cloneTrackFromLegacy(lpRaw||{}),fr:cloneTrackFromLegacy(lpRaw||{})}};
    const cp=cpRaw?.tracks?cpRaw:null;
    if(!cp){out.progress[id]=lp;continue;}
    out.progress[id]={favorite:!!(lp.favorite||cp.favorite),foundation:!!(lp.foundation||cp.foundation),tracks:{}};
    for(const lang of LANGS)out.progress[id].tracks[lang]=mergeTrack(lp.tracks?.[lang],cp.tracks?.[lang]);
  }
  out.reviews=Math.max(Number(local?.reviews||0),Number(cloud?.reviews||0));
  out.version=5;
  return out;
}
async function pullCloudState(){
  if(!isAiSignedIn()||!window.puter?.fs?.read)return false;
  try{
    const blob=await window.puter.fs.read('LexiBridge4/state-v5.json');
    const cloud=JSON.parse(await blob.text());
    state=mergeStates(state,cloud);saveState({cloud:false});renderHome();return true;
  }catch{return false;}
}
async function syncNow(){
  try{
    await ensureAiAuth();setAiBusy(true,'同步中');
    await pullCloudState();await pushCloudState();updateAiStatus();toast('学习记录与 AI 缓存索引已同步');
  }catch(err){updateAiStatus();toast(err.message||'同步失败');}
}
async function loadPack(c,{cloud=true}={}){
  const key=packKey(c);
  if(packMemory.has(key))return packMemory.get(key);
  const seed=SEED_PACKS[cardId(c)];
  if(seed){packMemory.set(key,seed);await dbSet(key,seed);markRich(c);return seed;}
  const local=await dbGet(key);
  if(local){packMemory.set(key,local);markRich(c);return local;}
  if(cloud&&isAiSignedIn()){
    try{
      const remote=await window.puter.kv.get(cloudPackKey(c));
      if(remote&&remote.schema===PACK_SCHEMA){packMemory.set(key,remote);await dbSet(key,remote);markRich(c);return remote;}
    }catch{}
  }
  return null;
}
async function savePack(c,pack){
  const key=packKey(c);packMemory.set(key,pack);await dbSet(key,pack);markRich(c);
  if(isAiSignedIn()){
    try{await window.puter.kv.set(cloudPackKey(c),pack);}catch{}
  }
}
async function removePack(c){
  const key=packKey(c);packMemory.delete(key);await dbDelete(key);
  state.richIndex=state.richIndex.filter(x=>x!==cardId(c));saveState();
  if(isAiSignedIn()){try{await window.puter.kv.del(cloudPackKey(c));}catch{}}
}
function markRich(c){
  const id=cardId(c);if(!state.richIndex.includes(id)){state.richIndex.push(id);saveState();}
}
function hasRich(c){return state.richIndex.includes(cardId(c))||packMemory.has(packKey(c))||!!SEED_PACKS[cardId(c)];}

function makeCard(r,idx){
  const rank=idx+1,[bandId,bandLabel]=BAND(rank);
  const pos=typeof r[1]==='number'?(POS[r[1]]||'word'):String(r[1]||'word');
  const c={
    en:String(r[0]||''),pos,level:LEVEL[r[2]]||'C1',topic:(window.LB4_TOPICS||[])[r[3]]||'通用',
    meaning:{en:String(r[4]||''),zh:String(r[5]||''),de:String(r[6]||''),fr:String(r[7]||'')},
    rank,frequencyRank:r[8]??null,frequencyCount:r[9]??null,synset:String(r[10]||rank),
    quality:Number(r[11]||0),band:{id:bandId,label:bandLabel},
    naturalExample:{en:String(r[12]||''),zh:String(r[13]||''),de:String(r[14]||''),fr:String(r[15]||'')},
    related:{en:cleanArray(r[16]),zh:cleanArray(r[17]),de:cleanArray(r[18]),fr:cleanArray(r[19])},
    originalSurface:String(r[20]||'')
  };
  c.searchText=normalize([c.en,c.originalSurface,c.meaning.en,c.meaning.zh,c.meaning.de,c.meaning.fr,...c.related.en,...c.related.zh,...c.related.de,...c.related.fr].join(' '));
  return c;
}
function migrateProgressKeys(){
  const valid=new Map(cards.map(c=>[cardId(c),c]));let changed=false;
  for(const [k,p] of Object.entries({...state.progress})){
    if(valid.has(k)){ensureP(valid.get(k));continue;}
    const m=k.match(/^(.*)-(noun|verb|adjective|adverb|phrase|word)-(.+)$/);
    if(!m)continue;
    const nk=`${m[1]}-${m[2]}`;
    if(valid.has(nk)){if(!state.progress[nk])state.progress[nk]=p;delete state.progress[k];ensureP(valid.get(nk));changed=true;}
  }
  if(changed)saveState({cloud:false});
}
async function buildCards(){
  const rows=window.LB4_ROWS||[];
  cards=rows.map(makeCard);
  byRank=new Map(cards.map(c=>[c.rank,c]));
  byHead=new Map(cards.map(c=>[c.en,c]));
  migrateProgressKeys();
  const seedIds=Object.keys(SEED_PACKS);
  for(const id of seedIds)if(!state.richIndex.includes(id))state.richIndex.push(id);
  saveState({cloud:false});
  $('#buildState').textContent=cards.length===10000?'10,000 个概念词已载入 · 三种目标语言独立间隔复习':'词库加载 '+cards.length.toLocaleString()+'/10,000';
  $('#startBtn').disabled=!cards.length;
  renderHome();
}

function progressSummary(){
  const out={mastered:0,learning:0,due:0,new:0,partial:0};
  for(const c of cards)out[cardStatus(c)]++;
  return out;
}
function languageSummary(lang){
  let mastered=0,learning=0,due=0,known=0;
  for(const c of cards){
    const p=getP(c);if(!p)continue;const t=p.tracks[lang];
    if(t.known)known++;
    if(trackDone(t))mastered++;
    else if(trackDue(t))due++;
    else if(t.reviews>0)learning++;
  }
  return{mastered,learning,due,known};
}
function dueTasks(){
  const out=[];
  for(const c of cards){
    const p=getP(c);if(!p)continue;
    for(const lang of enabledLangs()){
      const t=p.tracks[lang];if(trackDue(t))out.push({card:c,lang,due:t.due});
    }
  }
  return out.sort((a,b)=>a.due-b.due||a.card.rank-b.card.rank);
}
function isNewConcept(c){
  const p=getP(c);if(!p)return true;
  return enabledLangs().every(l=>{const t=p.tracks[l];return !t.reviews&&!t.known&&!t.mastered;});
}
function newConcepts(limit=state.settings.dailyNew){
  const start=Number(state.settings.startRank||2501);
  return cards.filter(c=>c.rank>=start&&isNewConcept(c)).slice(0,limit);
}
function renderHome(){
  if(!cards.length)return;
  const sum=progressSummary(),due=dueTasks(),fresh=newConcepts();
  $('#todayDue').textContent=Math.min(due.length,Number(state.settings.reviewCap||90));
  $('#todayNew').textContent=fresh.length;
  $('#mastered').textContent=sum.mastered;
  $('#richCount').textContent=state.richIndex.length;
}
function switchView(id){
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===id));
  window.scrollTo({top:0,behavior:'instant'});
  if(id==='browseView')renderSearch();
  if(id==='statsView')renderStats();
  if(id==='settingsView')loadSettingsUI();
}
function openStatus(status){
  filters.status=status;filters.page=1;
  $('#statusFilter').value=status;
  switchView('browseView');
}

function morphCandidates(q){
  const w=normalize(q),s=new Set([w]);
  const irr={went:'go',gone:'go',children:'child',people:'person',men:'man',women:'woman',teeth:'tooth',feet:'foot',mice:'mouse',geese:'goose',criteria:'criterion',phenomena:'phenomenon',analyses:'analysis',indices:'index',matrices:'matrix',better:'good',best:'good',worse:'bad',worst:'bad'};
  if(irr[w])s.add(irr[w]);if(!/^[a-z'-]+$/.test(w))return s;
  if(w.endsWith('ied')&&w.length>4)s.add(w.slice(0,-3)+'y');
  if(w.endsWith('ies')&&w.length>4)s.add(w.slice(0,-3)+'y');
  if(w.endsWith('ed')&&w.length>4){const stem=w.slice(0,-2);s.add(stem);s.add(stem+'e');if(stem.length>2&&stem.at(-1)===stem.at(-2))s.add(stem.slice(0,-1));}
  if(w.endsWith('ing')&&w.length>5){const stem=w.slice(0,-3);s.add(stem);s.add(stem+'e');if(stem.length>2&&stem.at(-1)===stem.at(-2))s.add(stem.slice(0,-1));}
  if(w.endsWith('es')&&w.length>4){s.add(w.slice(0,-2));s.add(w.slice(0,-1));}
  if(w.endsWith('s')&&w.length>3)s.add(w.slice(0,-1));
  return s;
}
function levenshtein(a,b,max=2){
  if(Math.abs(a.length-b.length)>max)return max+1;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const cur=[i];let rowMin=i;
    for(let j=1;j<=b.length;j++){cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));rowMin=Math.min(rowMin,cur[j]);}
    if(rowMin>max)return max+1;prev=cur;
  }
  return prev[b.length];
}
function scoreCard(c,q){
  if(!q)return 0;
  const nq=normalize(q),en=normalize(c.en),morph=morphCandidates(nq);
  if(en===nq)return 0;if(morph.has(en))return 3;if(en.startsWith(nq))return 9;if(nq.startsWith(en))return 13;if(en.includes(nq))return 18;
  for(const x of [c.meaning.zh,c.meaning.de,c.meaning.fr]){
    const n=normalize(x);if(n===nq)return 22;if(n.startsWith(nq))return 27;if(n.includes(nq))return 34;
  }
  if(normalize(c.meaning.en).includes(nq))return 40;if(c.searchText.includes(nq))return 48;
  if(nq.length>=4){const d=levenshtein(en,nq,2);if(d<=2)return 70+d;}
  return Infinity;
}
function statusMatch(c,status){
  if(status==='all')return true;
  if(status==='favorite')return !!getP(c)?.favorite;
  if(status==='rich')return hasRich(c);
  return cardStatus(c)===status;
}
function filteredCards(){
  const q=filters.q;let arr=[];
  for(const c of cards){
    if(filters.band!=='all'&&c.band.id!==filters.band)continue;
    if(filters.pos!=='all'&&c.pos!==filters.pos)continue;
    if(!statusMatch(c,filters.status))continue;
    const score=scoreCard(c,q);if(score===Infinity)continue;
    arr.push({c,score});
  }
  if(filters.sort==='alpha')arr.sort((a,b)=>a.c.en.localeCompare(b.c.en));
  else if(filters.sort==='recent')arr.sort((a,b)=>latestCardTime(b.c)-latestCardTime(a.c)||a.c.rank-b.c.rank);
  else if(filters.sort==='rank')arr.sort((a,b)=>a.c.rank-b.c.rank);
  else arr.sort((a,b)=>a.score-b.score||a.c.rank-b.c.rank);
  return arr.map(x=>x.c);
}
function latestCardTime(c){
  const p=getP(c);if(!p)return 0;return Math.max(...LANGS.map(l=>Number(p.tracks[l].last||0)));
}
function renderSearch(){
  if(!cards.length)return;
  filters.q=$('#searchInput').value.trim();filters.status=$('#statusFilter').value;filters.pos=$('#posFilter').value;filters.sort=$('#sortFilter').value;
  const arr=filteredCards(),size=Number(state.settings.pageSize)||40,pages=Math.max(1,Math.ceil(arr.length/size));
  filters.page=Math.min(Math.max(1,filters.page),pages);
  const start=(filters.page-1)*size,visible=arr.slice(start,start+size);
  $('#resultSummary').textContent=`共 ${arr.length.toLocaleString()} 个结果 · 显示 ${arr.length?start+1:0}–${Math.min(start+size,arr.length)}`;
  $('#pageInfo').textContent=`第 ${filters.page} / ${pages} 页`;$('#prevPage').disabled=filters.page<=1;$('#nextPage').disabled=filters.page>=pages;$('#pager').classList.toggle('hidden',arr.length===0);
  $('#searchResults').innerHTML=visible.length?visible.map(resultHTML).join(''):'<div class="empty">没有匹配结果</div>';
  $$('.resultCard').forEach(b=>b.onclick=()=>openDetail(byRank.get(Number(b.dataset.rank))));
}
function resultHTML(c){
  const p=getP(c),st=cardStatus(c);
  const bars=LANGS.map(l=>{const t=p?.tracks?.[l];return `<span class="${t&&trackDone(t)?'done':t?.reviews?'learn':''}" title="${LANG_META[l].name}"></span>`;}).join('');
  return `<button class="resultCard" type="button" data-rank="${c.rank}">
    <div class="resultTop"><div class="resultTitle"><span class="rank">#${c.rank}</span><strong>${esc(c.en)}</strong>${hasRich(c)?'<span class="richMark">✦</span>':''}${p?.favorite?'<span>★</span>':''}</div>
    <div class="resultMetaLine"><span>${esc(POS_ZH[c.pos]||c.pos)}</span><span>${esc(c.level)}</span><span>${esc(c.band.label)}</span><span class="statusPill ${st==='mastered'?'good':st==='due'?'warn':''}">${statusLabel(c)}</span></div><div class="taskBars">${bars}</div></div>
    <div class="langs"><span>中 ${esc(c.meaning.zh)}</span><span>DE ${esc(c.meaning.de)}</span><span>FR ${esc(c.meaning.fr)}</span></div>
  </button>`;
}
function resetBrowse(){
  filters={band:'all',status:'all',pos:'all',sort:'relevance',q:'',page:1};
  $('#searchInput').value='';$('#statusFilter').value='all';$('#posFilter').value='all';$('#sortFilter').value='relevance';
  $$('.chip').forEach(b=>b.classList.toggle('active',b.dataset.band==='all'));renderSearch();
}

function baseContext(c){
  return {
    englishHeadword:c.en,
    currentPartOfSpeech:c.pos,
    currentEnglishDefinition:c.meaning.en,
    chineseGloss:c.meaning.zh,
    germanCandidate:c.meaning.de,
    frenchCandidate:c.meaning.fr,
    frequencyRank:c.rank,
    learningBand:c.band.label,
    topic:c.topic
  };
}
function richSchemaText(){
  return `{
  "schema":"${PACK_SCHEMA}",
  "concept":{"zh":"","domain":"","senseNoteZh":""},
  "headwords":{
    "en":{"word":"","pos":"","pronunciation":"","grammar":"","forms":[{"label":"","form":""}],"derivatives":[{"word":"","pos":"","zh":""}]},
    "de":{"word":"","pos":"","pronunciation":"","article":"","plural":"","grammar":"","forms":[{"label":"","form":""}],"derivatives":[{"word":"","pos":"","zh":""}]},
    "fr":{"word":"","pos":"","pronunciation":"","gender":"","plural":"","grammar":"","forms":[{"label":"","form":""}],"derivatives":[{"word":"","pos":"","zh":""}]}
  },
  "families":[{"functionZh":"","zh":"","en":"","de":"","fr":"","noteZh":""}],
  "synonyms":[{"nuanceZh":"","zh":"","en":"","de":"","fr":"","register":"","differenceZh":""}],
  "antonyms":[{"nuanceZh":"","zh":"","en":"","de":"","fr":"","register":"","differenceZh":""}],
  "collocations":[{"functionZh":"","zh":"","en":"","de":"","fr":"","register":"","noteZh":""}],
  "examples":[{"scenarioZh":"","zh":"","en":"","de":"","fr":"","noteZh":""}],
  "usageNotes":[{"titleZh":"","detailZh":"","en":"","de":"","fr":""}],
  "audit":{"reviewed":false,"passes":1,"summaryZh":"","warnings":[]}
}`;
}
function generationPrompt(c){
  const ctx=JSON.stringify(baseContext(c),null,2);
  return `你是一位严苛的中英德法四语词典主编、德语和法语语法编辑，以及间隔学习设计师。为中文母语者制作“概念中心”的英德法三语学习包。

学习目标：
- 中文只作为语义锚点；英语、德语、法语是三种独立的目标语言。
- 每一条同义词、反义词、搭配和例句都必须用中文说明其共同语义功能，并给出英语、德语、法语中自然、常用、可实际使用的对应表达。
- 对应不是逐字翻译。三种语言语法结构可以不同，但必须表达同一功能。
- 不要把所有近义词当作完全同义词；必须说明语义差异、语域和可替换边界。
- 不要为了填满字段编造不自然搭配。优先选择高频、通用、TOEFL/大学阅读和现实交流有价值的内容。
- 对多义词选择最常见、最有学习价值的核心义。若输入词典义偏冷僻，可纠正并在 senseNoteZh 说明。
- 内部先完成初稿，再逐项批判：检查硬译、词性错误、德语冠词/复数/动词主要形式、法语阴阳性/复数/动词主要形式、英语屈折变化、例句是否真的使用目标词、四语是否同一情境。只输出修订后的 JSON。

内容下限：
1. 三种语言各自完整词形与语法。英语动词给第三人称、过去式、过去分词、现在分词；名词给复数；形容词给比较级/最高级。德语名词给冠词、复数和必要的格信息；动词给三单、过去时、第二分词和完成时；形容词给比较级/最高级。法语名词/形容词给阴阳性和复数；动词给现在时关键形式、未完成过去时、复合过去时/过去分词、将来时。
2. 词族/派生 5–8 行，每行四语按“功能”对照，不要求词形机械同源。
3. 同义词 5–7 行，每行写 nuanceZh 和 differenceZh。
4. 反义词/对立表达 3–5 行。
5. 核心常用搭配 10–14 行，覆盖宾语搭配、形容词/副词搭配、介词结构、固定表达和专业常用语。functionZh 必须解释该搭配的用途。
6. 四语平行例句 6 行。每行是同一真实情境的自然表达；英语、德语、法语都必须自然使用本卡目标词或其正确变形，中文是该情境的自然翻译。
7. 易混点/使用限制 3–6 条，包括易混近义词、介词、语域、假朋友或不可直译之处。

输入基础信息（只能作为线索，不可盲从错误翻译）：
${ctx}

严格按以下 JSON 结构输出。禁止 Markdown、代码围栏、解释文字或引用来源：
${richSchemaText()}`;
}
function reviewPrompt(c,draft){
  return `你是另一位独立的中英德法四语词典终审。下面是一份学习包草稿。你的任务不是表扬，而是逐行寻找并修复：
- 四语语义漂移或逐字硬译；
- 德语冠词、复数、格、动词主要形式错误；
- 法语性、数、介词、变位错误；
- 英语词形和搭配错误；
- 罕见、过时或并不“常用”的搭配；
- 同义词实际并不同义却没有说明差异；
- 例句没有使用目标词，或四种语言不是同一情境；
- 重复、空洞、模板化或没有学习价值的内容。

保留 JSON 结构，必要时彻底重写项目。最终必须至少有 10 个高价值搭配、6 个平行例句、5 个同义词、3 个反义词。audit.reviewed=true，audit.passes=2，summaryZh 简要写明终审做了什么，warnings 只保留仍无法完全消除的不确定点。只输出最终 JSON，不要 Markdown。

基础词信息：
${JSON.stringify(baseContext(c),null,2)}

待终审草稿：
${JSON.stringify(draft)}`;
}
function expansionPrompt(c,pack,type){
  const isColl=type==='collocations';
  const existing=JSON.stringify(pack[isColl?'collocations':'examples']||[]);
  const schema=isColl
    ? `[{"functionZh":"","zh":"","en":"","de":"","fr":"","register":"","noteZh":""}]`
    : `[{"scenarioZh":"","zh":"","en":"","de":"","fr":"","noteZh":""}]`;
  return `你是中英德法四语词典编辑。为 ${c.en}（核心义：${pack.concept?.zh||c.meaning.zh}）补充${isColl?'8 个此前未出现的高价值常用搭配':'4 个此前未出现的四语平行例句'}。
要求：
- 每行中文、英语、德语、法语表达同一语义功能/同一情境；
- 三种目标语言必须自然使用对应目标词或其正确变形；
- 不逐字硬译，不重复现有内容，不写空洞模板；
- 先自我批判语法、语域、自然度后再输出。
现有内容：${existing}
只输出 JSON 数组，结构为：${schema}`;
}
function extractResponseText(res){
  if(typeof res==='string')return res;
  const content=res?.message?.content??res?.content??res?.text??res;
  if(typeof content==='string')return content;
  if(Array.isArray(content))return content.map(x=>typeof x==='string'?x:(x?.text||x?.content||'')).join('');
  return JSON.stringify(content);
}
function parseJsonLoose(text){
  let s=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(s);}catch{}
  const a=s.indexOf('{'),b=s.lastIndexOf('}');
  if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1));}catch{}}
  const aa=s.indexOf('['),bb=s.lastIndexOf(']');
  if(aa>=0&&bb>aa){try{return JSON.parse(s.slice(aa,bb+1));}catch{}}
  throw new Error('AI 返回的 JSON 无法解析');
}
function normalizeHeadword(obj,fallback){
  const o=obj&&typeof obj==='object'?obj:{};
  return {
    word:String(o.word||fallback||''),pos:String(o.pos||''),pronunciation:String(o.pronunciation||''),
    article:String(o.article||''),plural:String(o.plural||''),gender:String(o.gender||''),grammar:String(o.grammar||''),
    forms:Array.isArray(o.forms)?o.forms.map(x=>({label:String(x?.label||''),form:String(x?.form||'')})).filter(x=>x.form):[],
    derivatives:Array.isArray(o.derivatives)?o.derivatives.map(x=>({word:String(x?.word||''),pos:String(x?.pos||''),zh:String(x?.zh||'')})).filter(x=>x.word):[]
  };
}
function normalizeAlignedRows(rows,kind){
  const out=(Array.isArray(rows)?rows:[]).map(x=>({
    functionZh:String(x?.functionZh||''),nuanceZh:String(x?.nuanceZh||''),scenarioZh:String(x?.scenarioZh||''),
    zh:String(x?.zh||''),en:String(x?.en||''),de:String(x?.de||''),fr:String(x?.fr||''),
    register:String(x?.register||''),noteZh:String(x?.noteZh||''),differenceZh:String(x?.differenceZh||'')
  })).filter(x=>x.zh&&x.en&&x.de&&x.fr);
  return out.slice(0,kind==='collocations'?240:kind==='examples'?120:80);
}
function normalizePack(raw,c){
  if(!raw||typeof raw!=='object')throw new Error('AI 学习包为空');
  const pack={
    schema:PACK_SCHEMA,generatedAt:new Date().toISOString(),model:String(raw.model||state.settings.aiModel),
    concept:{zh:String(raw.concept?.zh||c.meaning.zh),domain:String(raw.concept?.domain||''),senseNoteZh:String(raw.concept?.senseNoteZh||'')},
    headwords:{
      en:normalizeHeadword(raw.headwords?.en,c.en),
      de:normalizeHeadword(raw.headwords?.de,c.meaning.de),
      fr:normalizeHeadword(raw.headwords?.fr,c.meaning.fr)
    },
    families:normalizeAlignedRows(raw.families,'families'),
    synonyms:normalizeAlignedRows(raw.synonyms,'synonyms'),
    antonyms:normalizeAlignedRows(raw.antonyms,'antonyms'),
    collocations:normalizeAlignedRows(raw.collocations,'collocations'),
    examples:normalizeAlignedRows(raw.examples,'examples'),
    usageNotes:(Array.isArray(raw.usageNotes)?raw.usageNotes:[]).map(x=>({titleZh:String(x?.titleZh||''),detailZh:String(x?.detailZh||''),en:String(x?.en||''),de:String(x?.de||''),fr:String(x?.fr||'')})).filter(x=>x.titleZh||x.detailZh),
    audit:{reviewed:!!raw.audit?.reviewed,passes:Number(raw.audit?.passes||1),summaryZh:String(raw.audit?.summaryZh||''),warnings:cleanArray(raw.audit?.warnings)}
  };
  if(!pack.headwords.en.word||!pack.headwords.de.word||!pack.headwords.fr.word)throw new Error('AI 未给出完整三语目标词');
  if(pack.collocations.length<6||pack.examples.length<4)throw new Error('AI 内容不足：搭配或例句数量过少');
  return pack;
}
let modelCatalogPromise = null;
async function resolveAiModel(preferred){
  const clean=String(preferred||'').replace(/^anthropic\//,'');
  try{
    modelCatalogPromise ||= window.puter.ai.listModels();
    const models=await modelCatalogPromise;
    const ids=new Set();
    for(const m of Array.isArray(models)?models:[]){
      if(m?.id)ids.add(String(m.id));
      for(const a of Array.isArray(m?.aliases)?m.aliases:[])ids.add(String(a));
    }
    for(const id of [preferred,clean,'claude-sonnet-4-6','gpt-5.5','gpt-5.4','gpt-5-nano']){
      if(id&&ids.has(id))return id;
    }
    const available=[...ids];
    return available.find(x=>/claude.*sonnet/i.test(x))
      ||available.find(x=>/^gpt-5(?:\.|-|$)/i.test(x))
      ||available[0]
      ||clean
      ||undefined;
  }catch{
    return clean||undefined;
  }
}
async function callAi(prompt,model=state.settings.aiModel){
  await ensureAiAuth();
  const resolved=await resolveAiModel(model);
  const options={temperature:0.15,max_tokens:12000};
  if(resolved)options.model=resolved;
  const res=await window.puter.ai.chat(prompt,options);
  return extractResponseText(res);
}
async function generatePack(c,{force=false,review=null}={}){
  const key=packKey(c);
  if(packPromises.has(key))return packPromises.get(key);
  const job=(async()=>{
    if(!force){
      const cached=await loadPack(c);if(cached)return cached;
    }
    setAiBusy(true,'生成中');
    try{
      const first=normalizePack(parseJsonLoose(await callAi(generationPrompt(c))),c);
      first.model=state.settings.aiModel;
      let final=first;
      const shouldReview=review===null?!!state.settings.doublePass:!!review;
      if(shouldReview){
        setAiBusy(true,'校对中');
        try{
          final=normalizePack(parseJsonLoose(await callAi(reviewPrompt(c,first))),c);
          final.model=state.settings.aiModel;final.audit.reviewed=true;final.audit.passes=Math.max(2,final.audit.passes||2);
        }catch(err){
          first.audit.warnings=uniqueStrings([...(first.audit.warnings||[]),'第二轮终审未完成：'+(err.message||'未知错误')]);
          final=first;
        }
      }
      await savePack(c,final);
      updateCardSearchFromPack(c,final);
      return final;
    }finally{updateAiStatus();}
  })();
  packPromises.set(key,job);
  try{return await job;}finally{packPromises.delete(key);}
}
async function reviewPack(c,pack){
  setAiBusy(true,'复核中');
  try{
    const final=normalizePack(parseJsonLoose(await callAi(reviewPrompt(c,pack))),c);
    final.model=state.settings.aiModel;final.audit.reviewed=true;final.audit.passes=Math.max(2,Number(pack.audit?.passes||1)+1);
    await savePack(c,final);updateCardSearchFromPack(c,final);return final;
  }finally{updateAiStatus();}
}
async function expandPack(c,pack,type){
  setAiBusy(true,type==='collocations'?'扩展搭配':'扩展例句');
  try{
    const arr=parseJsonLoose(await callAi(expansionPrompt(c,pack,type)));
    const rows=normalizeAlignedRows(arr,type);
    if(!rows.length)throw new Error('AI 没有返回可用的新内容');
    const field=type;
    const old=pack[field]||[],seen=new Set(old.map(x=>normalize([x.en,x.de,x.fr].join('|'))));
    for(const row of rows){const k=normalize([row.en,row.de,row.fr].join('|'));if(!seen.has(k)){old.push(row);seen.add(k);}}
    pack[field]=old.slice(0,type==='collocations'?240:120);
    pack.generatedAt=new Date().toISOString();
    pack.audit.summaryZh=`在现有双重校对学习包上继续扩展了${type==='collocations'?'搭配':'例句'}。`;
    await savePack(c,pack);return pack;
  }finally{updateAiStatus();}
}
function updateCardSearchFromPack(c,pack){
  const extra=[
    pack.concept?.zh,
    ...Object.values(pack.headwords||{}).flatMap(h=>[h.word,h.grammar,...(h.forms||[]).map(x=>x.form),...(h.derivatives||[]).map(x=>x.word)]),
    ...(pack.collocations||[]).flatMap(x=>[x.zh,x.en,x.de,x.fr]),
    ...(pack.synonyms||[]).flatMap(x=>[x.zh,x.en,x.de,x.fr])
  ];
  c.searchText=normalize(c.searchText+' '+extra.filter(Boolean).join(' '));
}

function buildStudyQueue(){
  const due=dueTasks().slice(0,Number(state.settings.reviewCap||90));
  const concepts=newConcepts();
  const langs=enabledLangs();
  const fresh=[];
  for(let i=0;i<concepts.length;i++){
  for(let li=0;li<langs.length;li++)fresh.push({card:concepts[(i+li)%concepts.length],lang:langs[li],due:Infinity,newConcept:true});
}
  return [...due,...fresh];
}
function startStudy(){
  queue=buildStudyQueue();qi=0;
  if(!queue.length){toast('今天没有到期任务或新概念');return;}
  switchView('studyView');showStudyTask();
}
function chooseDirection(t){
  const mode=state.settings.directionMode;
  if(mode==='recognition'||mode==='production')return mode;
  if(mode==='alternate')return t.reviews%2===0?'recognition':'production';
  if(t.reviews<2)return'recognition';
  return t.reviews%3===0?'recognition':'production';
}
function baseTarget(c,lang){return lang==='en'?c.en:c.meaning[lang];}
function packTarget(pack,c,lang){return pack?.headwords?.[lang]?.word||baseTarget(c,lang);}
function cueMeaning(c,pack){return pack?.concept?.zh||c.meaning.zh;}
async function showStudyTask(){
  currentTask=queue[qi];
  if(!currentTask){toast('今日学习完成');switchView('homeView');renderHome();return;}
  const {card:c,lang}=currentTask,t=getTrack(c,lang),direction=chooseDirection(t);
  currentTask.direction=direction;
  const cached=await loadPack(c,{cloud:true});
  currentTask.pack=cached;
  const target=packTarget(cached,c,lang),zh=cueMeaning(c,cached);
  $('#studyProgress').textContent=`${qi+1} / ${queue.length}`;
  $('#queueLabel').textContent=currentTask.newConcept?'新概念任务':'到期复习';
  $('#progressBar').style.width=`${Math.round(qi/queue.length*100)}%`;
  $('#bandBadge').textContent=c.band.label;$('#posBadge').textContent=`${POS_ZH[c.pos]||c.pos} · ${c.level}`;
  $('#langBadge').textContent=LANG_META[lang].name;$('#directionBadge').textContent=direction==='recognition'?'识别：目标语 → 中文':'产出：中文 → 目标语';
  $('#statusBadge').textContent=trackDone(t)?'已掌握':trackDue(t)?'到期':t.reviews?'学习中':'新任务';
  if(direction==='recognition'){
    $('#cueLabel').textContent=`识别 ${LANG_META[lang].name}`;
    $('#studyCue').textContent=target;
    $('#recallPrompt').textContent='先说出准确的中文核心义；不要依赖另外两种目标语言猜答案。';
    $('#studySpeakBtn').classList.remove('hidden');$('#studySpeakBtn').onclick=()=>speakText(target,LANG_META[lang].locale);
  }else{
    $('#cueLabel').textContent=`产出 ${LANG_META[lang].name}`;
    $('#studyCue').textContent=zh;
    $('#recallPrompt').textContent=`根据中文概念主动说出 ${LANG_META[lang].name} 目标词；尽量同时回忆词形或冠词。`;
    $('#studySpeakBtn').classList.add('hidden');$('#studySpeakBtn').onclick=null;
  }
  $('#answer').classList.add('hidden');$('#revealBtn').classList.remove('hidden');
  if(state.settings.autoAI&&isAiSignedIn()&&!cached)ensureStudyPack(c);
}
async function ensureStudyPack(c){
  $('#studyAiPanel').innerHTML='<div class="aiMini"><div class="loader"><span class="spinner"></span><span>正在生成并双重校对四语学习包…</span></div></div>';
  try{
    const pack=await generatePack(c);if(currentTask?.card===c){currentTask.pack=pack;if(!$('#answer').classList.contains('hidden'))renderStudyRich(pack,c);}
  }catch(err){
    if(currentTask?.card===c)$('#studyAiPanel').innerHTML=`<div class="aiMini"><h3>AI 学习包暂未生成</h3><p>${esc(err.message||'请稍后重试')}</p><button class="secondary full" type="button" id="studyGenerateBtn">重新生成</button></div>`;
    $('#studyGenerateBtn')?.addEventListener('click',()=>ensureStudyPack(c));
  }
}
function meaningHTML(c,pack=null){
  const values={
    zh:pack?.concept?.zh||c.meaning.zh,
    en:pack?.headwords?.en?.word||c.en,
    de:pack?.headwords?.de?.word||c.meaning.de,
    fr:pack?.headwords?.fr?.word||c.meaning.fr
  };
  return [['中文','zh','zh-CN'],['English','en','en-US'],['Deutsch','de','de-DE'],['Français','fr','fr-FR']].map(([label,k,locale])=>`<div class="meaningBox"><header><label>${label}</label>${k==='zh'?'':`<button class="miniSpeak dynSpeak" type="button" data-speak="${esc(values[k])}" data-lang="${locale}">🔊</button>`}</header><p>${esc(values[k])}</p></div>`).join('');
}
function studyMeaningHTML(c,pack,lang){
  const zh=pack?.concept?.zh||c.meaning.zh;
  const target=packTarget(pack,c,lang);
  return `<div class="meaningBox"><header><label>中文语义</label></header><p>${esc(zh)}</p></div><div class="meaningBox"><header><label>${LANG_META[lang].name}</label><button class="miniSpeak dynSpeak" type="button" data-speak="${esc(target)}" data-lang="${LANG_META[lang].locale}">🔊</button></header><p>${esc(target)}</p></div>`;
}
function bindDynamicSpeech(root=document){root.querySelectorAll('.dynSpeak').forEach(b=>b.onclick=()=>speakText(b.dataset.speak,b.dataset.lang));}
function renderStudyRich(pack,c){
  if(!pack){
    $('#studyAiPanel').innerHTML='<div class="aiMini"><h3>基础答案已显示</h3><p>启用 AI 后可生成三语词形、词族、同义词、核心搭配和四语平行例句。完整四语对照放在主动回忆之后查看，避免提前泄露另外两种语言的答案。</p><button class="secondary full" type="button" id="studyGenerateBtn">生成四语学习包</button></div>';
    $('#studyGenerateBtn')?.addEventListener('click',async()=>{try{await ensureAiAuth();await ensureStudyPack(c);}catch(err){toast(err.message);}});
    return;
  }
  const lang=currentTask?.lang||'en';
  const cols=(pack.collocations||[]).slice(0,3).map(x=>`<p><b>${esc(x.functionZh||x.zh)}</b><br>${esc(x.zh)} → ${esc(x[lang])}</p>`).join('');
  const ex=pack.examples?.[0];
  $('#studyAiPanel').innerHTML=`<div class="aiMini"><h3>${pack.audit?.reviewed?'双重校对学习包':'AI 学习包'} · ${LANG_META[lang].name} 预览</h3><p>先完成这一语言的回忆；完整中英德法对照请打开词卡。</p>${cols}${ex?`<p><b>${esc(ex.scenarioZh||'平行例句')}</b><br>${esc(ex.zh)}<br>${esc(ex[lang])}</p>`:''}</div>`;
}
async function revealStudy(){
  if(!currentTask)return;
  const {card:c,lang,pack}=currentTask;
  const target=packTarget(pack,c,lang);
  $('#targetAnswer').textContent=target;$('#answerSpeakBtn').onclick=()=>speakText(target,LANG_META[lang].locale);
  $('#studyMeaningGrid').innerHTML=studyMeaningHTML(c,pack,lang);
  bindDynamicSpeech($('#studyMeaningGrid'));
  renderStudyRich(pack,c);
  $('#answer').classList.remove('hidden');$('#revealBtn').classList.add('hidden');
}
function rateTask(kind){
  if(!currentTask)return;
  const {card:c,lang}=currentTask,t=getTrack(c,lang),old=Math.max(0,Number(t.interval||0));let days=0;
  if(kind==='again'){t.streak=0;t.reps=Math.max(0,t.reps-1);days=10/(60*24);}
  else if(kind==='hard'){t.streak++;t.reps++;days=old?Math.max(1,old*1.35):1;}
  else if(kind==='good'){t.streak++;t.reps++;days=old?Math.max(2,old*2.35):2;}
  else{t.streak++;t.reps++;days=old?Math.max(4,old*3.2):4;}
  t.known=false;t.interval=Math.round(days*100)/100;t.last=Date.now();t.due=Date.now()+days*DAY;t.reviews++;state.reviews++;
  if(kind==='again'){
    if(currentTask.direction==='recognition')t.recognitionSuccess=Math.max(0,(t.recognitionSuccess||0)-1);
    else t.productionSuccess=Math.max(0,(t.productionSuccess||0)-1);
  }else{
    if(currentTask.direction==='recognition')t.recognitionSuccess=(t.recognitionSuccess||0)+1;
    else t.productionSuccess=(t.productionSuccess||0)+1;
  }
  t.mastered=t.reps>=Number(state.settings.masterReps)&&t.streak>=3&&t.interval>=Number(state.settings.masterDays)&&(t.recognitionSuccess||0)>=2&&(t.productionSuccess||0)>=2;
  saveState();qi++;showStudyTask();renderHome();
}
function markCurrentKnown(){
  if(!currentTask)return;const t=getTrack(currentTask.card,currentTask.lang);
  t.known=true;t.mastered=true;t.last=Date.now();t.due=0;saveState();qi++;showStudyTask();renderHome();
}

function alignedRowsHTML(rows,kind){
  if(!rows?.length)return'<div class="empty">暂未生成可靠内容</div>';
  return rows.map(row=>{
    const title=row.functionZh||row.nuanceZh||row.scenarioZh||row.zh;
    const meta=[row.register,row.differenceZh||row.noteZh].filter(Boolean).join(' · ');
    return `<div class="alignedRow"><div class="alignedRowHeader"><b>${esc(title)}</b><span>${esc(meta)}</span></div>
      <div class="alignedCells"><div class="alignedCell"><small>中</small><span>${esc(row.zh)}</span></div><div class="alignedCell"><small>EN</small><span>${esc(row.en)}</span></div><div class="alignedCell"><small>DE</small><span>${esc(row.de)}</span></div><div class="alignedCell"><small>FR</small><span>${esc(row.fr)}</span></div></div></div>`;
  }).join('');
}
function formsHTML(pack){
  return LANGS.map(lang=>{
    const h=pack.headwords?.[lang]||{},extras=[h.article&&`冠词：${h.article}`,h.gender&&`性：${h.gender}`,h.plural&&`复数：${h.plural}`,h.pronunciation&&`发音：${h.pronunciation}`].filter(Boolean);
    const forms=(h.forms||[]).map(x=>`<p><b>${esc(x.label)}</b> ${esc(x.form)}</p>`).join('');
    const deriv=(h.derivatives||[]).slice(0,8).map(x=>`<p><b>${esc(x.word)}</b> ${esc(x.pos)} · ${esc(x.zh)}</p>`).join('');
    return `<div class="formCard"><h3>${LANG_META[lang].name} · ${esc(h.word||'—')}</h3>${extras.map(x=>`<p>${esc(x)}</p>`).join('')}<p>${esc(h.grammar||'')}</p>${forms}${deriv?`<p><b>常用派生</b></p>${deriv}`:''}</div>`;
  }).join('');
}
function examplesHTML(rows){
  if(!rows?.length)return'<div class="empty">暂未生成可靠例句</div>';
  return rows.map((x,i)=>`<article class="exampleCard"><h3>${i+1}. ${esc(x.scenarioZh||'平行情境')}${x.noteZh?` · ${esc(x.noteZh)}`:''}</h3>
    <div class="exampleLine"><b>中</b><span>${esc(x.zh)}</span></div><div class="exampleLine"><b>EN</b><span>${esc(x.en)}</span></div><div class="exampleLine"><b>DE</b><span>${esc(x.de)}</span></div><div class="exampleLine"><b>FR</b><span>${esc(x.fr)}</span></div></article>`).join('');
}
function notesHTML(rows){
  if(!rows?.length)return'<div class="empty">暂无额外使用限制</div>';
  return rows.map(x=>`<div class="noteItem"><b>${esc(x.titleZh||'使用提示')}</b><span>${esc(x.detailZh||'')}</span>${x.en||x.de||x.fr?`<div class="exampleLine"><b>EN</b><span>${esc(x.en||'—')}</span></div><div class="exampleLine"><b>DE</b><span>${esc(x.de||'—')}</span></div><div class="exampleLine"><b>FR</b><span>${esc(x.fr||'—')}</span></div>`:''}</div>`).join('');
}
function progressHTML(c){
  const p=getP(c)||newProgress();
  return `<div class="progressFacts">${LANGS.map(lang=>{
    const t=p.tracks[lang],status=t.known?'原本已会':t.mastered?'已掌握':trackDue(t)?'到期':t.reviews?'学习中':'未学习';
    const due=t.due&&!t.known?new Date(t.due).toLocaleDateString():'—';
    return `<div class="trackFact"><header><b>${LANG_META[lang].name}</b><span>${status}</span></header><p>评分 ${t.reviews||0} 次 · 连续 ${t.streak||0} · 间隔 ${t.interval||0} 天<br>识别成功 ${t.recognitionSuccess||0} · 产出成功 ${t.productionSuccess||0}<br>下次：${esc(due)}</p></div>`;
  }).join('')}</div>`;
}
function renderPack(pack,c){
  detailPack=pack;
  $('#richPack').classList.remove('hidden');
  $('#aiHeroText').textContent=pack.audit?.reviewed?`已完成 ${pack.audit.passes||2} 轮生成/批判校对。${pack.audit.summaryZh||''}`:`已生成初稿；建议点击“AI 再校对”。`;
  $('#generateAiBtn').textContent='已生成';
  $('#formsGrid').innerHTML=formsHTML(pack);
  $('#familiesTable').innerHTML=alignedRowsHTML(pack.families,'families');
  $('#synonymsTable').innerHTML=alignedRowsHTML(pack.synonyms,'synonyms');
  $('#antonymsTable').innerHTML=alignedRowsHTML(pack.antonyms,'antonyms');
  $('#collocationsTable').innerHTML=alignedRowsHTML(pack.collocations,'collocations');
  $('#examplesDeck').innerHTML=examplesHTML(pack.examples);
  $('#usageNotes').innerHTML=notesHTML(pack.usageNotes);
  const warn=pack.audit?.warnings?.length?` · ${pack.audit.warnings.length} 个不确定点`:'';
  $('#packAuditBadge').textContent=`${pack.audit?.reviewed?'双重校对':'单次生成'}${warn}`;
  bindDynamicSpeech($('#richPack'));
  updateCardSearchFromPack(c,pack);
}
function renderPackLoading(msg='正在生成四语学习包…'){
  $('#aiHeroText').innerHTML=`<span class="loader"><span class="spinner"></span><span>${esc(msg)}</span></span>`;
  $('#generateAiBtn').disabled=true;$('#generateAiBtn').textContent='处理中';
}
function renderPackEmpty(c){
  detailPack=null;$('#richPack').classList.add('hidden');$('#generateAiBtn').disabled=false;$('#generateAiBtn').textContent='生成学习包';
  $('#aiHeroText').textContent=isAiSignedIn()?'尚未生成。点击后将按当前核心义生成并进行批判校对。':'登录 Puter 后，AI 可按词生成三语词形、词族、同义词、搭配和四语平行例句。';
}
async function openDetail(c){
  if(!c)return;detailCard=c;detailPack=null;
  const p=getP(c);
  $('#detailWord').textContent=c.en;$('#favoriteBtn').textContent=p?.favorite?'★':'☆';
  $('#detailBadges').innerHTML=`<span>#${c.rank}</span><span>${esc(POS_ZH[c.pos]||c.pos)} · ${esc(c.level)}</span><span>${esc(c.band.label)}</span><span>${statusLabel(c)}</span>${hasRich(c)?'<span>AI 学习包</span>':''}`;
  $('#detailMeaningGrid').innerHTML=meaningHTML(c,null);bindDynamicSpeech($('#detailMeaningGrid'));
  $('#detailProgress').innerHTML=progressHTML(c);
  $('#detailKnownBtn').textContent=enabledLangs().every(l=>trackDone(getTrack(c,l)))?'撤销所选语言“已会”':'所选语言标记原本已会';
  $('#detailRelearnBtn').textContent='所选语言重新加入复习';
  $('#detailBackdrop').classList.remove('hidden');document.body.style.overflow='hidden';
  renderPackEmpty(c);
  const pack=await loadPack(c);
  if(detailCard!==c)return;
  if(pack)renderPack(pack,c);
  else if(state.settings.autoAI&&isAiSignedIn()){
    renderPackLoading('正在自动生成并校对…');
    try{const generated=await generatePack(c);if(detailCard===c)renderPack(generated,c);}
    catch(err){if(detailCard===c){renderPackEmpty(c);$('#aiHeroText').textContent=err.message||'生成失败，请重试。';}}
  }
}
function closeDetail(){detailCard=null;detailPack=null;$('#detailBackdrop').classList.add('hidden');document.body.style.overflow='';}
async function handleGenerate(){
  if(!detailCard)return;
  try{
    await ensureAiAuth();renderPackLoading(state.settings.doublePass?'正在生成并进行第二轮批判校对…':'正在生成学习包…');
    const pack=await generatePack(detailCard,{force:true});
    if(detailCard)renderPack(pack,detailCard);renderHome();renderSearch();
  }catch(err){renderPackEmpty(detailCard);toast(err.message||'AI 生成失败',3500);}
}
async function handleReview(){
  if(!detailCard||!detailPack)return;
  try{renderPackLoading('正在逐行批判语义、语法和自然度…');const pack=await reviewPack(detailCard,detailPack);if(detailCard)renderPack(pack,detailCard);toast('终审校对完成');}
  catch(err){renderPack(detailPack,detailCard);toast(err.message||'AI 复核失败',3500);}
}
async function handleExpand(type){
  if(!detailCard||!detailPack)return;
  try{renderPackLoading(type==='collocations'?'正在扩展不重复搭配…':'正在生成更多平行情境…');const pack=await expandPack(detailCard,detailPack,type);if(detailCard)renderPack(pack,detailCard);toast(type==='collocations'?'搭配已扩展':'例句已扩展');}
  catch(err){renderPack(detailPack,detailCard);toast(err.message||'扩展失败',3500);}
}
async function handleRegenerate(){
  if(!detailCard)return;if(!confirm(`重新生成 “${detailCard.en}” 的 AI 学习包？现有缓存会被替换。`))return;
  await handleGenerate();
}
async function handleDeletePack(){
  if(!detailCard||!detailPack)return;if(!confirm(`删除 “${detailCard.en}” 的 AI 学习包缓存？`))return;
  await removePack(detailCard);renderPackEmpty(detailCard);renderHome();renderSearch();toast('AI 学习包缓存已删除');
}
function toggleFavorite(){
  if(!detailCard)return;const p=ensureP(detailCard);p.favorite=!p.favorite;saveState();$('#favoriteBtn').textContent=p.favorite?'★':'☆';renderSearch();
}
function toggleDetailKnown(){
  if(!detailCard)return;const p=ensureP(detailCard),langs=enabledLangs(),all=langs.every(l=>trackDone(p.tracks[l]));
  for(const l of langs){const t=p.tracks[l];if(all){t.known=false;t.mastered=t.reviews>0&&t.reps>=state.settings.masterReps&&t.streak>=3&&t.interval>=state.settings.masterDays;}else{t.known=true;t.mastered=true;t.last=Date.now();t.due=0;}}
  saveState();$('#detailProgress').innerHTML=progressHTML(detailCard);renderHome();renderSearch();
}
function relearnDetail(){
  if(!detailCard)return;const p=ensureP(detailCard);
  for(const l of enabledLangs()){const t=p.tracks[l];t.known=false;t.mastered=false;t.reviews=Math.max(1,t.reviews||0);t.due=Date.now();t.last=Date.now();}
  saveState();$('#detailProgress').innerHTML=progressHTML(detailCard);renderHome();renderSearch();toast('所选语言已加入到期复习');
}
function resetDetail(){
  if(!detailCard)return;if(!confirm(`重置 “${detailCard.en}” 的全部三语学习记录？`))return;
  delete state.progress[cardId(detailCard)];saveState();$('#detailProgress').innerHTML=progressHTML(detailCard);renderHome();renderSearch();toast('学习记录已重置');
}

function renderStats(){
  const blocks=LANGS.map(lang=>{const s=languageSummary(lang);return `<div class="card langStat"><header><h2>${LANG_META[lang].name}</h2><span class="langCode">${LANG_META[lang].short}</span></header><div class="langNumbers"><div><b>${s.mastered}</b><span>已掌握</span></div><div><b>${s.due}</b><span>到期</span></div><div><b>${s.learning}</b><span>学习中</span></div><div><b>${s.known}</b><span>原本已会</span></div></div></div>`;}).join('');
  $('#languageStats').innerHTML=blocks;
  const base=new Date();base.setHours(0,0,0,0);const bins=Array(7).fill(0);
  for(const c of cards){const p=getP(c);if(!p)continue;for(const l of enabledLangs()){const t=p.tracks[l];if(trackDone(t)||!t.due)continue;const d=Math.floor((t.due-base.getTime())/DAY);if(d>=0&&d<7)bins[d]++;}}
  const max=Math.max(1,...bins);$('#forecast').innerHTML=bins.map((n,i)=>`<div><i style="height:${Math.max(5,n/max*100)}%"></i><b>${n}</b><span>${i===0?'今天':`+${i}天`}</span></div>`).join('');
  const recent=cards.filter(c=>latestCardTime(c)).sort((a,b)=>latestCardTime(b)-latestCardTime(a)).slice(0,10);
  $('#recentList').innerHTML=recent.length?recent.map(c=>`<button class="miniItem" type="button" data-rank="${c.rank}"><b>${esc(c.en)}</b><span>${statusLabel(c)} · ${new Date(latestCardTime(c)).toLocaleDateString()}</span></button>`).join(''):'<div class="empty">还没有学习记录</div>';
  $$('#recentList .miniItem').forEach(b=>b.onclick=()=>openDetail(byRank.get(Number(b.dataset.rank))));
}
function loadSettingsUI(){
  const s=state.settings;$('#dailyNew').value=s.dailyNew;$('#reviewCap').value=s.reviewCap;$('#startBand').value=String(s.startRank);$('#languageMode').value=s.languageMode;$('#directionMode').value=s.directionMode;$('#masterReps').value=s.masterReps;$('#masterDays').value=s.masterDays;$('#pageSize').value=String(s.pageSize||40);$('#aiModel').value=s.aiModel;$('#autoAI').checked=!!s.autoAI;$('#doublePass').checked=!!s.doublePass;
  const any=Object.values(state.progress).some(p=>p.foundation);$('#foundationToggle').textContent=any?'撤销核心 2,500 词三语“已会”标记':'将核心 2,500 词三语标记为已会';
  updateAiStatus();
}
function clamp(v,a,b){v=parseInt(v,10);return Number.isFinite(v)?Math.min(b,Math.max(a,v)):a;}
function saveSettingsUI(){
  state.settings.dailyNew=clamp($('#dailyNew').value,0,40);state.settings.reviewCap=clamp($('#reviewCap').value,10,300);state.settings.startRank=Number($('#startBand').value);state.settings.languageMode=$('#languageMode').value;state.settings.directionMode=$('#directionMode').value;state.settings.masterReps=clamp($('#masterReps').value,3,20);state.settings.masterDays=clamp($('#masterDays').value,14,180);state.settings.pageSize=Number($('#pageSize').value)||40;state.settings.aiModel=$('#aiModel').value;state.settings.autoAI=$('#autoAI').checked;state.settings.doublePass=$('#doublePass').checked;saveState();renderHome();toast('设置已保存');
}
function foundationToggle(){
  const reverting=Object.values(state.progress).some(p=>p.foundation);let n=0;
  if(reverting){
    for(const c of cards.slice(0,2500)){const p=getP(c);if(!p?.foundation)continue;p.foundation=false;for(const l of LANGS){const t=p.tracks[l];if(t.known&&!t.reviews){t.known=false;t.mastered=false;}}if(!p.favorite&&LANGS.every(l=>!p.tracks[l].reviews&&!p.tracks[l].known))delete state.progress[cardId(c)];n++;}
    toast(`已撤销 ${n} 个基础概念的批量标记`);
  }else{
    for(const c of cards.slice(0,2500)){const p=getP(c);if(p&&LANGS.some(l=>p.tracks[l].reviews||p.tracks[l].known||p.tracks[l].mastered))continue;const np=ensureP(c);np.foundation=true;for(const l of LANGS){const t=np.tracks[l];t.known=true;t.mastered=true;t.last=Date.now();}n++;}
    toast(`已将 ${n} 个基础概念三语标记为已会`);
  }
  saveState();loadSettingsUI();renderHome();
}
async function exportData(){
  const packs={};
  for(const id of state.richIndex){
    const c=cards.find(x=>cardId(x)===id);if(!c)continue;const p=await loadPack(c,{cloud:false});if(p)packs[id]=p;
  }
  const payload={app:'LexiBridge4',schema:5,exportedAt:new Date().toISOString(),state,packs};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=`LexiBridge4_full_backup_${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function importData(file){
  try{
    const d=JSON.parse(await file.text());if(!d?.state?.progress)throw 0;
    state={...defaultState(),...d.state,version:5,settings:{...defaultState().settings,...(d.state.settings||{})},progress:d.state.progress||{},richIndex:Array.isArray(d.state.richIndex)?d.state.richIndex:[]};
    if(d.packs&&typeof d.packs==='object'){for(const [id,pack] of Object.entries(d.packs)){const c=cards.find(x=>cardId(x)===id);if(c&&pack?.schema===PACK_SCHEMA)await savePack(c,pack);}}
    saveState();renderHome();toast('学习记录与 AI 学习包已导入');
  }catch{toast('备份文件无效');}
}
function resetAll(){
  if(!confirm('确定清空全部学习记录？AI 学习包缓存会保留。'))return;
  state={...defaultState(),richIndex:[...state.richIndex]};saveState();applyTheme();renderHome();toast('学习记录已清空');
}
function speakText(text,lang){
  if(!text||!('speechSynthesis'in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=lang;speechSynthesis.speak(u);
}
function applyTheme(){const mode=state.settings.theme;document.documentElement.dataset.theme=mode==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):mode;}
function toggleTheme(){state.settings.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';saveState();applyTheme();}
async function forceUpdate(){
  toast('正在刷新到最新版…',2500);
  try{const regs=await navigator.serviceWorker?.getRegistrations?.()||[];for(const r of regs)await r.update();const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('lexibridge4-')).map(k=>caches.delete(k)));}catch{}
  setTimeout(()=>location.replace(`${location.pathname}?v=${Date.now()}`),350);
}
function registerSW(){if(location.protocol==='https:'&&navigator.serviceWorker?.register)navigator.serviceWorker.register('./sw.js?v=9').catch(()=>{});}

function showInfo(){ $('#infoBackdrop').classList.remove('hidden'); }
function closeInfo(){ $('#infoBackdrop').classList.add('hidden'); }

function bind(){
  $$('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
  $$('[data-open-status]').forEach(b=>b.onclick=()=>openStatus(b.dataset.openStatus));
  $('#startBtn').onclick=startStudy;$('#revealBtn').onclick=revealStudy;$('#endStudy').onclick=()=>{switchView('homeView');renderHome();};
  $$('.rating button').forEach(b=>b.onclick=()=>rateTask(b.dataset.rate));$('#knownCurrent').onclick=markCurrentKnown;$('#openStudyDetail').onclick=()=>currentTask&&openDetail(currentTask.card);

  $('#searchInput').oninput=()=>{filters.page=1;renderSearch();};$('#clearSearch').onclick=()=>{$('#searchInput').value='';filters.page=1;renderSearch();};
  $$('.chip').forEach(b=>b.onclick=()=>{filters.band=b.dataset.band;filters.page=1;$$('.chip').forEach(x=>x.classList.toggle('active',x===b));renderSearch();});
  for(const id of ['statusFilter','posFilter','sortFilter'])$('#'+id).onchange=()=>{filters.page=1;renderSearch();};
  $('#resetFilters').onclick=resetBrowse;$('#prevPage').onclick=()=>{filters.page=Math.max(1,filters.page-1);renderSearch();window.scrollTo({top:0,behavior:'smooth'});};$('#nextPage').onclick=()=>{filters.page++;renderSearch();window.scrollTo({top:0,behavior:'smooth'});};
  $('#pageInfo').onclick=()=>{const arr=filteredCards(),pages=Math.max(1,Math.ceil(arr.length/(state.settings.pageSize||40))),v=Number(prompt(`输入页码 1–${pages}`,filters.page));if(v>=1&&v<=pages){filters.page=v;renderSearch();}};
  $('#jumpRankBtn').onclick=()=>{const v=Number(prompt('输入词库序号 1–10000'));const c=byRank.get(v);if(c)openDetail(c);else toast('序号无效');};

  $('#closeDetail').onclick=closeDetail;$('#detailBackdrop').onclick=e=>{if(e.target===$('#detailBackdrop'))closeDetail();};$('#favoriteBtn').onclick=toggleFavorite;
  $('#speakEnglish').onclick=()=>detailCard&&speakText(detailPack?.headwords?.en?.word||detailCard.en,'en-US');
  $('#speakGerman').onclick=()=>detailCard&&speakText(detailPack?.headwords?.de?.word||detailCard.meaning.de,'de-DE');
  $('#speakFrench').onclick=()=>detailCard&&speakText(detailPack?.headwords?.fr?.word||detailCard.meaning.fr,'fr-FR');
  $('#generateAiBtn').onclick=handleGenerate;$('#reviewAiBtn').onclick=handleReview;$('#regenerateAiBtn').onclick=handleRegenerate;$('#deleteAiBtn').onclick=handleDeletePack;$('#expandCollocationsBtn').onclick=()=>handleExpand('collocations');$('#expandExamplesBtn').onclick=()=>handleExpand('examples');
  $('#detailKnownBtn').onclick=toggleDetailKnown;$('#detailRelearnBtn').onclick=relearnDetail;$('#detailResetBtn').onclick=resetDetail;

  $('#saveSettings').onclick=saveSettingsUI;$('#foundationToggle').onclick=foundationToggle;$('#exportBtn').onclick=exportData;$('#importInput').onchange=e=>e.target.files[0]&&importData(e.target.files[0]);$('#resetBtn').onclick=resetAll;
  $('#themeBtn').onclick=toggleTheme;$('#updateBtn').onclick=forceUpdate;
  $('#aiBtn').onclick=async()=>{try{await ensureAiAuth();toast('AI 已启用：打开任意词即可生成四语学习包');}catch(err){toast(err.message||'AI 登录失败');}};
  $('#aiSignInBtn').onclick=$('#aiBtn').onclick;$('#syncNowBtn').onclick=syncNow;
  $('#aiExplainBtn').onclick=showInfo;$('#closeInfo').onclick=closeInfo;$('#infoBackdrop').onclick=e=>{if(e.target===$('#infoBackdrop'))closeInfo();};$('#infoEnableAi').onclick=async()=>{closeInfo();try{await ensureAiAuth();toast('AI 已启用');}catch(err){toast(err.message);}};
}
async function init(){
  applyTheme();bind();await buildCards();switchView('homeView');registerSW();updateAiStatus();
  if(isAiSignedIn())pullCloudState().then(()=>renderHome()).catch(()=>{});
}
document.addEventListener('DOMContentLoaded',init);
})();
