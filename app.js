(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const DAY = 86_400_000;
  const POS = ['noun', 'verb', 'adjective', 'adverb', 'phrase'];
  const POS_ZH = { noun: '名词', verb: '动词', adjective: '形容词', adverb: '副词', phrase: '短语', word: '词' };
  const LEVEL = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const STORE = 'lexibridge4_state_v4';
  const LEGACY_STORES = ['lexibridge4_state_v3', 'lexibridge4_state_v2'];
  const CORPUS_CACHE_VERSION = 2;
  const TATOEBA_API = 'https://api.tatoeba.org/v1/sentences';
  const LANG = {
    en: { code: 'eng', locale: 'en-US', label: 'EN' },
    zh: { code: 'cmn', locale: 'zh-CN', label: '中' },
    de: { code: 'deu', locale: 'de-DE', label: 'DE' },
    fr: { code: 'fra', locale: 'fr-FR', label: 'FR' },
  };
  const BAND = (rank) => rank <= 2500
    ? ['core', '核心 1–2500']
    : rank <= 5000
      ? ['upper', '中高级 2501–5000']
      : rank <= 8000
        ? ['academic', '学术 5001–8000']
        : ['advanced', '高级 8001–10000'];

  const defaultState = () => ({
    version: 4,
    settings: {
      dailyNew: 12,
      reviewCap: 120,
      startRank: 2501,
      masterReps: 5,
      masterDays: 30,
      pageSize: 40,
      theme: 'system',
    },
    progress: {},
    reviews: 0,
  });

  let state = loadState();
  let cards = [];
  let byRank = new Map();
  let queue = [];
  let qi = 0;
  let current = null;
  let detailCard = null;
  let filters = { band: 'all', status: 'all', pos: 'all', sort: 'relevance', q: '', page: 1 };
  const memoryCorpus = new Map();

  injectCorpusStyles();

  function injectCorpusStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .corpusLoading{padding:18px;border:1px dashed var(--line);border-radius:13px;text-align:center;color:var(--muted);font-size:12px;line-height:1.6}
      .corpusLoading::before{content:'◌';display:inline-block;margin-right:7px;animation:lbSpin 1s linear infinite;color:var(--accent)}
      @keyframes lbSpin{to{transform:rotate(360deg)}}
      .multiLines{display:grid;gap:10px;min-width:0}.corpusEntry{display:block;color:var(--text);line-height:1.55}
      .corpusMeta{display:flex;gap:7px;flex-wrap:wrap;margin-top:3px;color:var(--muted);font-size:9px;line-height:1.35}
      .corpusMeta a{color:var(--accent);text-decoration:none}.evidenceTag{padding:2px 6px;border-radius:999px;background:var(--accent2);color:var(--muted)}
      .missingCorpus{color:var(--muted);font-style:italic;line-height:1.55}.sourceAction{border:0;background:none;color:var(--accent);padding:0 0 0 6px;font-size:10px}
      .sourceSummary{display:inline-flex;align-items:center;gap:3px;flex-wrap:wrap;justify-content:flex-end}
      .phrasePreview{white-space:normal!important;display:-webkit-box!important;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .qualityBanner{margin-top:8px;padding:10px 12px;border-radius:12px;background:var(--accent2);color:var(--muted);font-size:10px;line-height:1.55}
    `;
    document.head.appendChild(style);
  }

  function loadState() {
    try {
      let raw = localStorage.getItem(STORE);
      if (!raw) {
        for (const key of LEGACY_STORES) {
          raw = localStorage.getItem(key);
          if (raw) break;
        }
      }
      if (!raw) return defaultState();
      const x = JSON.parse(raw);
      const d = defaultState();
      const out = {
        ...d,
        ...x,
        version: 4,
        settings: { ...d.settings, ...(x.settings || {}) },
        progress: x.progress || {},
      };
      localStorage.setItem(STORE, JSON.stringify(out));
      return out;
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORE, JSON.stringify(state));
  }

  function toast(msg, ms = 1800) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove('show'), ms);
  }

  function esc(s = '') {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function normalize(s = '') {
    return String(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .replace(/[’]/g, "'")
      .trim();
  }

  function cleanArr(x) {
    return Array.isArray(x) ? x.filter(Boolean).map(String) : [];
  }

  function cardId(c) {
    return `${c.en}-${c.pos}`;
  }

  function ensureP(c) {
    const id = cardId(c);
    return state.progress[id] ||= {
      reps: 0,
      streak: 0,
      interval: 0,
      due: 0,
      reviews: 0,
      known: false,
      mastered: false,
      favorite: false,
      foundation: false,
      last: 0,
    };
  }

  function getP(c) {
    return state.progress[cardId(c)] || null;
  }

  function migrateLegacyProgress() {
    const valid = new Set(cards.map(cardId));
    let changed = false;
    for (const [key, p] of Object.entries({ ...state.progress })) {
      if (valid.has(key)) continue;
      const m = key.match(/^(.*)-(noun|verb|adjective|adverb|phrase|word)-(.+)$/);
      if (!m) continue;
      const next = `${m[1]}-${m[2]}`;
      if (valid.has(next)) {
        if (!state.progress[next]) state.progress[next] = p;
        delete state.progress[key];
        changed = true;
      }
    }
    if (changed) saveState();
  }

  function makeCard(r, idx) {
    const rank = idx + 1;
    const [bandId, bandLabel] = BAND(rank);
    const pos = typeof r[1] === 'number' ? (POS[r[1]] || 'word') : String(r[1] || 'word');
    const c = {
      en: String(r[0] || ''),
      pos,
      level: LEVEL[r[2]] || 'C1',
      topic: (window.LB4_TOPICS || [])[r[3]] || '通用',
      meaning: {
        en: String(r[4] || ''),
        zh: String(r[5] || ''),
        de: String(r[6] || ''),
        fr: String(r[7] || ''),
      },
      rank,
      frequencyRank: r[8] ?? null,
      frequencyCount: r[9] ?? null,
      synset: String(r[10] || rank),
      quality: Number(r[11] || 0),
      band: { id: bandId, label: bandLabel },
      naturalExample: {
        en: String(r[12] || ''),
        zh: String(r[13] || ''),
        de: String(r[14] || ''),
        fr: String(r[15] || ''),
      },
      related: {
        en: cleanArr(r[16]),
        zh: cleanArr(r[17]),
        de: cleanArr(r[18]),
        fr: cleanArr(r[19]),
      },
      forms: cleanArr(r[20]),
    };
    c.searchText = normalize([
      c.en, c.meaning.en, c.meaning.zh, c.meaning.de, c.meaning.fr,
      ...c.related.en, ...c.related.zh, ...c.related.de, ...c.related.fr,
      ...c.forms,
    ].join(' '));
    return c;
  }

  function buildCards() {
    const rows = window.LB4_ROWS || [];
    cards = rows.map(makeCard);
    byRank = new Map(cards.map((c) => [c.rank, c]));
    migrateLegacyProgress();
    const strict = cards.filter((c) => c.quality >= 3).length;
    $('#buildState').textContent = cards.length === 10_000
      ? `10,000 张词卡已载入 · 自然语料按需获取并缓存`
      : `词库加载 ${cards.length.toLocaleString()}/10,000`;
    const quality = $('#qualitySummary');
    if (quality) {
      quality.textContent = `基础词义保持同一概念对齐（严格卡 ${strict.toLocaleString()} 张）；搭配与例句不再使用模板句，而是在打开词卡时从 Tatoeba 检索真实人类语料。首次查看需联网，随后缓存在本机。`;
    }
    $('#startBtn').disabled = !cards.length;
    renderHome();
  }

  function statusOf(c) {
    const p = getP(c);
    if (!p) return 'new';
    if (p.known) return 'known';
    if (p.mastered) return 'mastered';
    if (p.reviews > 0 && p.due && p.due <= Date.now()) return 'due';
    if (p.reviews > 0) return 'learning';
    return 'new';
  }

  function statusLabel(c) {
    return ({ new: '未学习', learning: '学习中', due: '到期', mastered: '已掌握', known: '原本已会' })[statusOf(c)] || '未学习';
  }

  function progressStats() {
    let seen = 0, mastered = 0, known = 0, learning = 0;
    for (const p of Object.values(state.progress)) {
      if (p.reviews || p.known) seen++;
      if (p.mastered) mastered++;
      if (p.known) known++;
      if (p.reviews > 0 && !p.mastered && !p.known) learning++;
    }
    return { seen, mastered, known, learning };
  }

  function dueCards() {
    const now = Date.now();
    return cards
      .filter((c) => {
        const p = getP(c);
        return p && !p.known && p.reviews > 0 && p.due <= now;
      })
      .sort((a, b) => getP(a).due - getP(b).due);
  }

  function newCards(limit = state.settings.dailyNew) {
    const start = state.settings.startRank || 2501;
    return cards
      .filter((c) => {
        const p = getP(c);
        return c.rank >= start && !(p?.reviews > 0) && !p?.known && !p?.mastered;
      })
      .slice(0, limit);
  }

  function renderHome() {
    if (!cards.length) return;
    const s = progressStats();
    const d = dueCards();
    $('#todayDue').textContent = Math.min(d.length, state.settings.reviewCap);
    $('#todayNew').textContent = newCards().length;
    $('#mastered').textContent = s.mastered;
    $('#learningCount').textContent = s.learning;
  }

  function switchView(id) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === id));
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (id === 'browseView') renderSearch();
    if (id === 'statsView') renderStats();
    if (id === 'settingsView') loadSettingsUI();
  }

  function openStatus(status) {
    filters.status = status;
    filters.page = 1;
    $('#statusFilter').value = status;
    switchView('browseView');
  }

  function startStudy() {
    const due = dueCards().slice(0, state.settings.reviewCap);
    const fresh = newCards();
    queue = [...due, ...fresh];
    qi = 0;
    if (!queue.length) {
      toast('今天没有到期复习或新词');
      return;
    }
    switchView('studyView');
    showStudyCard();
  }

  function showStudyCard() {
    current = queue[qi];
    if (!current) {
      toast('今日学习完成');
      switchView('homeView');
      renderHome();
      return;
    }
    const p = getP(current);
    $('#studyProgress').textContent = `${qi + 1} / ${queue.length}`;
    $('#queueLabel').textContent = p?.reviews ? '到期复习' : '新词';
    $('#progressBar').style.width = `${Math.round(qi / queue.length * 100)}%`;
    $('#studyWord').textContent = current.en;
    $('#bandBadge').textContent = current.band.label;
    $('#posBadge').textContent = `${POS_ZH[current.pos] || current.pos} · ${current.level}`;
    $('#qualityBadge').textContent = current.quality >= 3 ? '同概念词卡' : '对齐卡';
    $('#statusBadge').textContent = statusLabel(current);
    $('#answer').classList.add('hidden');
    $('#revealBtn').classList.remove('hidden');
  }

  function meaningHTML(c, preferred = {}) {
    const meaning = { ...c.meaning, ...preferred };
    return [
      ['中文', 'zh', 'zh-CN'], ['English', 'en', 'en-US'], ['Deutsch', 'de', 'de-DE'], ['Français', 'fr', 'fr-FR'],
    ].map(([label, key, lang]) => `
      <div class="meaningBox">
        <header><label>${label}</label>${key === 'zh' ? '' : `<button class="miniSpeak dynSpeak" type="button" data-speak="${esc(meaning[key])}" data-lang="${lang}">🔊</button>`}</header>
        <p>${esc(meaning[key])}</p>
      </div>`).join('');
  }

  function morphCandidates(q) {
    const w = normalize(q);
    const s = new Set([w]);
    const irr = {
      went: 'go', gone: 'go', children: 'child', people: 'person', men: 'man', women: 'woman',
      teeth: 'tooth', feet: 'foot', mice: 'mouse', geese: 'goose', criteria: 'criterion',
      phenomena: 'phenomenon', analyses: 'analysis', indices: 'index', matrices: 'matrix',
      better: 'good', best: 'good', worse: 'bad', worst: 'bad', contaminated: 'contaminate',
    };
    if (irr[w]) s.add(irr[w]);
    if (!/^[a-z'-]+$/.test(w)) return s;
    if (w.endsWith('ied') && w.length > 4) s.add(`${w.slice(0, -3)}y`);
    if (w.endsWith('ies') && w.length > 4) s.add(`${w.slice(0, -3)}y`);
    if (w.endsWith('ed') && w.length > 4) {
      const stem = w.slice(0, -2);
      s.add(stem); s.add(`${stem}e`);
      if (stem.length > 2 && stem.at(-1) === stem.at(-2)) s.add(stem.slice(0, -1));
    }
    if (w.endsWith('ing') && w.length > 5) {
      const stem = w.slice(0, -3);
      s.add(stem); s.add(`${stem}e`);
      if (stem.length > 2 && stem.at(-1) === stem.at(-2)) s.add(stem.slice(0, -1));
    }
    if (w.endsWith('es') && w.length > 4) { s.add(w.slice(0, -2)); s.add(w.slice(0, -1)); }
    if (w.endsWith('s') && w.length > 3) s.add(w.slice(0, -1));
    return s;
  }

  function levenshtein(a, b, max = 2) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        rowMin = Math.min(rowMin, cur[j]);
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  function scoreCard(c, q) {
    if (!q) return 0;
    const nq = normalize(q);
    const en = normalize(c.en);
    const morph = morphCandidates(nq);
    if (en === nq) return 0;
    if (morph.has(en) || c.forms.some((x) => normalize(x) === nq)) return 4;
    if (en.startsWith(nq)) return 10;
    if (nq.startsWith(en)) return 14;
    if (en.includes(nq)) return 20;
    for (const x of [c.meaning.zh, c.meaning.de, c.meaning.fr]) {
      const n = normalize(x);
      if (n === nq) return 24;
      if (n.startsWith(nq)) return 28;
      if (n.includes(nq)) return 36;
    }
    if (normalize(c.meaning.en).includes(nq)) return 42;
    if (c.searchText.includes(nq)) return 50;
    if (nq.length >= 4) {
      const d = levenshtein(en, nq, 2);
      if (d <= 2) return 70 + d;
    }
    return Infinity;
  }

  function statusMatch(c, status) {
    const p = getP(c);
    const st = statusOf(c);
    if (status === 'all') return true;
    if (status === 'favorite') return !!p?.favorite;
    if (status === 'new') return st === 'new';
    if (status === 'learning') return st === 'learning';
    if (status === 'due') return st === 'due';
    if (status === 'mastered') return st === 'mastered' || st === 'known';
    if (status === 'known') return st === 'known';
    return true;
  }

  function filteredCards() {
    const q = filters.q;
    const arr = [];
    for (const c of cards) {
      if (filters.band !== 'all' && c.band.id !== filters.band) continue;
      if (filters.pos !== 'all' && c.pos !== filters.pos) continue;
      if (!statusMatch(c, filters.status)) continue;
      const score = scoreCard(c, q);
      if (score === Infinity) continue;
      arr.push({ c, score });
    }
    if (filters.sort === 'alpha') arr.sort((a, b) => a.c.en.localeCompare(b.c.en));
    else if (filters.sort === 'recent') arr.sort((a, b) => (getP(b.c)?.last || 0) - (getP(a.c)?.last || 0) || a.c.rank - b.c.rank);
    else if (filters.sort === 'rank') arr.sort((a, b) => a.c.rank - b.c.rank);
    else arr.sort((a, b) => a.score - b.score || a.c.rank - b.c.rank);
    return arr.map((x) => x.c);
  }

  function renderSearch() {
    if (!cards.length) return;
    filters.q = $('#searchInput').value.trim();
    filters.status = $('#statusFilter').value;
    filters.pos = $('#posFilter').value;
    filters.sort = $('#sortFilter').value;
    const arr = filteredCards();
    const size = Number(state.settings.pageSize) || 40;
    const pages = Math.max(1, Math.ceil(arr.length / size));
    filters.page = Math.min(Math.max(1, filters.page), pages);
    const start = (filters.page - 1) * size;
    const visible = arr.slice(start, start + size);
    $('#resultSummary').textContent = `共 ${arr.length.toLocaleString()} 个结果 · 显示 ${arr.length ? start + 1 : 0}–${Math.min(start + size, arr.length)}`;
    $('#pageInfo').textContent = `第 ${filters.page} / ${pages} 页`;
    $('#prevPage').disabled = filters.page <= 1;
    $('#nextPage').disabled = filters.page >= pages;
    $('#pager').classList.toggle('hidden', arr.length === 0);
    $('#searchResults').innerHTML = visible.length ? visible.map(resultHTML).join('') : '<div class="empty">没有匹配结果</div>';
    $$('.resultCard').forEach((b) => { b.onclick = () => openDetail(byRank.get(Number(b.dataset.rank))); });
  }

  function resultHTML(c) {
    const p = getP(c);
    const st = statusOf(c);
    return `<button class="resultCard" type="button" data-rank="${c.rank}">
      <div class="resultTop">
        <div class="resultTitle"><span class="rank">#${c.rank}</span><strong>${esc(c.en)}</strong>${p?.favorite ? '<span>★</span>' : ''}</div>
        <div class="resultMetaLine"><span>${esc(POS_ZH[c.pos] || c.pos)}</span><span>${esc(c.level)}</span><span>${esc(c.band.label)}</span><span class="statusPill ${st === 'mastered' || st === 'known' ? 'good' : st === 'due' ? 'warn' : ''}">${statusLabel(c)}</span></div>
        <small class="phrasePreview">${esc(c.meaning.en)}</small>
      </div>
      <div class="langs"><span>中 ${esc(c.meaning.zh)}</span><span>DE ${esc(c.meaning.de)}</span><span>FR ${esc(c.meaning.fr)}</span></div>
    </button>`;
  }

  function resetBrowse() {
    filters = { band: 'all', status: 'all', pos: 'all', sort: 'relevance', q: '', page: 1 };
    $('#searchInput').value = '';
    $('#statusFilter').value = 'all';
    $('#posFilter').value = 'all';
    $('#sortFilter').value = 'relevance';
    $$('.chip').forEach((b) => b.classList.toggle('active', b.dataset.band === 'all'));
    renderSearch();
  }

  // ---------- Natural corpus engine ----------

  function corpusKey(c) {
    return `${CORPUS_CACHE_VERSION}|${c.synset}|${normalize(c.en)}`;
  }

  function openCorpusDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open('lexibridge4_corpus', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB failed'));
    });
  }

  async function corpusGet(key) {
    if (memoryCorpus.has(key)) return memoryCorpus.get(key);
    try {
      const db = await openCorpusDB();
      const value = await new Promise((resolve, reject) => {
        const tx = db.transaction('cards', 'readonly');
        const req = tx.objectStore('cards').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      if (value) memoryCorpus.set(key, value);
      return value;
    } catch {
      return null;
    }
  }

  async function corpusPut(key, value) {
    memoryCorpus.set(key, value);
    try {
      const db = await openCorpusDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('cards', 'readwrite');
        tx.objectStore('cards').put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch {
      // Memory cache still works for this session.
    }
  }

  function searchTerms(c, key) {
    const values = key === 'en'
      ? [c.en, ...c.forms, ...c.related.en]
      : [c.meaning[key], ...c.related[key]];
    const out = [];
    const seen = new Set();
    for (const raw of values) {
      const value = String(raw || '').trim();
      const n = normalize(value);
      if (!value || !n || seen.has(n)) continue;
      if (key === 'zh' && value.length < 2) continue;
      if (value.length > 45) continue;
      seen.add(n);
      out.push(value);
      if (out.length >= 4) break;
    }
    return out;
  }

  async function fetchJSON(url, timeout = 12_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function sentenceQuality(s, langKey, terms) {
    const text = String(s?.text || '').trim();
    if (!text || text.length < 4 || text.length > 240) return -Infinity;
    if (/https?:\/\/|www\.|[_<>]{2,}/i.test(text)) return -Infinity;
    if ((text.match(/\d/g) || []).length > Math.max(4, text.length * 0.2)) return -Infinity;
    const n = normalize(text);
    let match = 0;
    for (const term of terms) {
      const nt = normalize(term);
      if (!nt) continue;
      if (langKey === 'zh' ? text.includes(term) : new RegExp(`(^|[^\\p{L}])${escapeRegex(nt)}([^\\p{L}]|$)`, 'iu').test(n)) {
        match = Math.max(match, 30);
      } else if (n.includes(nt)) {
        match = Math.max(match, 15);
      }
    }
    if (!match) return -Infinity;
    const length = langKey === 'zh' ? text.length : tokenize(text, langKey).length;
    const target = langKey === 'zh' ? 22 : 10;
    const lengthScore = Math.max(-20, 18 - Math.abs(length - target) * 1.5);
    const ownerScore = s.owner ? 4 : 0;
    const licenseScore = s.license === 'CC0 1.0' ? 5 : 0;
    const punctuationPenalty = /[!?]{2,}|\.\.\./.test(text) ? -5 : 0;
    return match + lengthScore + ownerScore + licenseScore + punctuationPenalty;
  }

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async function queryTatoeba(langKey, term, includeTranslations = false) {
    const params = new URLSearchParams({
      lang: LANG[langKey].code,
      q: term,
      word_count: langKey === 'zh' ? '6-55' : '4-24',
      is_unapproved: 'no',
      is_orphan: 'no',
      sort: 'relevance',
      limit: '30',
    });
    if (includeTranslations) {
      params.set('showtrans', 'all');
      params.set('showtrans:lang', 'deu,fra,cmn');
      params.set('showtrans:is_direct', 'yes');
      params.set('showtrans:is_unapproved', 'no');
      params.set('showtrans:is_orphan', 'no');
    }
    const json = await fetchJSON(`${TATOEBA_API}?${params.toString()}`);
    return Array.isArray(json?.data) ? json.data : [];
  }

  async function searchTatoeba(langKey, terms, includeTranslations = false) {
    const merged = new Map();
    const attempted = [];
    for (const term of terms.slice(0, 3)) {
      attempted.push(term);
      try {
        const rows = await queryTatoeba(langKey, term, includeTranslations);
        for (const row of rows) {
          if (!row?.text) continue;
          const score = sentenceQuality(row, langKey, [term, ...terms]);
          if (score === -Infinity) continue;
          const id = row.id || `${langKey}:${row.text}`;
          const old = merged.get(id);
          if (!old || score > old._score) merged.set(id, { ...row, _score: score, _term: term });
        }
      } catch (err) {
        if (!merged.size && attempted.length === terms.slice(0, 3).length) throw err;
      }
      if (merged.size >= 30) break;
    }
    return [...merged.values()].sort((a, b) => b._score - a._score).slice(0, 36);
  }

  function tokenize(text, langKey) {
    const raw = String(text || '');
    try {
      const seg = new Intl.Segmenter(LANG[langKey].locale, { granularity: 'word' });
      return [...seg.segment(raw)].filter((x) => x.isWordLike).map((x) => x.segment);
    } catch {
      if (langKey === 'zh') return [...raw.replace(/[\s\p{P}\p{S}]/gu, '')];
      return raw.match(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu) || [];
    }
  }

  function simpleStem(token, langKey) {
    let t = normalize(token);
    if (t.length < 4) return t;
    if (langKey === 'en') {
      for (const end of ['ingly', 'edly', 'ing', 'ied', 'ies', 'ed', 'es', 's']) {
        if (t.endsWith(end) && t.length - end.length >= 3) {
          if (end === 'ied' || end === 'ies') return `${t.slice(0, -end.length)}y`;
          const base = t.slice(0, -end.length);
          return base.endsWith(base.at(-1) + base.at(-1)) ? base.slice(0, -1) : base;
        }
      }
    } else if (langKey === 'de') {
      for (const end of ['ern', 'em', 'er', 'en', 'es', 'e', 'n', 's']) if (t.endsWith(end) && t.length - end.length >= 4) return t.slice(0, -end.length);
    } else if (langKey === 'fr') {
      for (const end of ['aient', 'ement', 'ées', 'ée', 'ent', 'ons', 'ez', 'es', 'e', 's']) if (t.endsWith(end) && t.length - end.length >= 4) return t.slice(0, -end.length);
    }
    return t;
  }

  const STOP = {
    en: new Set('a an the and or but if of to in on at for from with by as is are was were be been being this that these those it its my your his her our their i you he she we they'.split(' ')),
    de: new Set('der die das ein eine einer einem einen und oder aber von zu in im auf an für mit aus bei als ist sind war waren sein diese dieser dieses'.split(' ')),
    fr: new Set('le la les un une des du de et ou mais à au aux en dans sur pour par avec comme est sont était être ce cette ces'.split(' ')),
    zh: new Set('的 了 在 是 和 与 或 一个 一种 这个 这 那 有 被 把 对 于 中'.split(' ')),
  };

  function termMatch(token, terms, langKey) {
    const n = normalize(token);
    const stem = simpleStem(n, langKey);
    for (const term of terms) {
      const nt = normalize(term);
      if (!nt) continue;
      if (n === nt) return 3;
      if (langKey !== 'zh' && stem.length >= 4 && stem === simpleStem(nt, langKey)) return 2;
      if (langKey === 'zh' && (n.includes(nt) || nt.includes(n))) return 2;
      if (n.length >= 5 && (n.startsWith(nt) || nt.startsWith(n))) return 1;
    }
    return 0;
  }

  function extractPhrases(rows, terms, langKey) {
    const candidates = new Map();
    for (const row of rows.slice(0, 36)) {
      const tokens = tokenize(row.text, langKey);
      if (tokens.length < 2) continue;
      const seenInSentence = new Set();
      for (let i = 0; i < tokens.length; i++) {
        const exactness = termMatch(tokens[i], terms, langKey);
        if (!exactness) continue;
        const windows = [
          [i, i + 2], [i - 1, i + 2], [i, i + 3], [i - 2, i + 1], [i - 1, i + 3], [i, i + 4],
        ];
        for (const [a0, b0] of windows) {
          const a = Math.max(0, a0);
          const b = Math.min(tokens.length, b0);
          const part = tokens.slice(a, b);
          if (part.length < 2 || part.length > 5) continue;
          const norms = part.map(normalize);
          const content = norms.filter((x) => x && !STOP[langKey].has(x));
          if (content.length < 1) continue;
          const matchLocal = Math.max(...part.map((x) => termMatch(x, terms, langKey)));
          if (!matchLocal) continue;
          const canonical = norms.map((x, j) => termMatch(part[j], terms, langKey) ? '*' : x).join(' ');
          if (seenInSentence.has(canonical)) continue;
          seenInSentence.add(canonical);
          const text = langKey === 'zh' ? part.join('') : part.join(' ');
          const edgePenalty = (STOP[langKey].has(norms[0]) ? 3 : 0) + (STOP[langKey].has(norms.at(-1)) ? 3 : 0);
          const lengthBonus = part.length === 3 ? 8 : part.length === 2 ? 6 : 4;
          const score = exactness * 12 + matchLocal * 8 + lengthBonus - edgePenalty;
          const existing = candidates.get(canonical) || { text, count: 0, score: 0, ids: new Set() };
          existing.count++;
          existing.score += score;
          existing.ids.add(row.id || row.text);
          if (text.length < existing.text.length || existing.count === 1) existing.text = text;
          candidates.set(canonical, existing);
        }
      }
    }
    const ranked = [...candidates.values()]
      .map((x) => ({ text: x.text, count: x.ids.size, score: x.score + x.ids.size * 100 }))
      .sort((a, b) => b.score - a.score || b.count - a.count || a.text.length - b.text.length);
    const out = [];
    for (const item of ranked) {
      const n = normalize(item.text);
      if (out.some((x) => normalize(x.text) === n || normalize(x.text).includes(n) || n.includes(normalize(x.text)))) continue;
      out.push({ text: item.text, count: item.count, kind: item.count >= 2 ? 'repeated' : 'observed' });
      if (out.length >= 3) break;
    }
    return out;
  }

  function sentenceObject(row, aligned = false) {
    return {
      text: String(row?.text || '').trim(),
      id: row?.id || null,
      lang: row?.lang || null,
      license: row?.license || '',
      owner: row?.owner || '',
      aligned,
    };
  }

  function translationsByLang(row) {
    const out = { zh: [], de: [], fr: [] };
    for (const tr of (row?.translations || [])) {
      if (!tr?.text || tr.is_direct === false || tr.is_unapproved) continue;
      const key = tr.lang === 'cmn' ? 'zh' : tr.lang === 'deu' ? 'de' : tr.lang === 'fra' ? 'fr' : null;
      if (key) out[key].push(tr);
    }
    return out;
  }

  function uniqueExamples(items, limit = 2) {
    const out = [];
    const seen = new Set();
    for (const item of items) {
      const n = normalize(item?.text);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(item);
      if (out.length >= limit) break;
    }
    return out;
  }

  function preferredTerm(c, key, examples) {
    const terms = searchTerms(c, key);
    for (const term of terms) {
      const nt = normalize(term);
      if (!nt) continue;
      if (examples.some((x) => normalize(x.text).includes(nt))) return term;
    }
    return c.meaning[key];
  }

  function fallbackBundle(c, error = '') {
    const examples = { en: [], zh: [], de: [], fr: [] };
    for (const key of Object.keys(examples)) {
      if (c.naturalExample[key]) examples[key].push({ text: c.naturalExample[key], id: null, lang: LANG[key].code, license: 'WordNet', owner: '', aligned: false });
    }
    return {
      version: CORPUS_CACHE_VERSION,
      builtAt: Date.now(),
      phrases: { en: [], zh: [], de: [], fr: [] },
      examples,
      preferred: { ...c.meaning },
      source: error ? `自然语料暂不可用：${error}` : '仅有词网自然例句；未生成模板句',
      counts: { en: 0, zh: 0, de: 0, fr: 0 },
      quality: 'fallback',
    };
  }

  async function buildNaturalBundle(c) {
    const terms = {
      en: searchTerms(c, 'en'), zh: searchTerms(c, 'zh'), de: searchTerms(c, 'de'), fr: searchTerms(c, 'fr'),
    };
    const settled = await Promise.allSettled([
      searchTatoeba('en', terms.en, true),
      searchTatoeba('zh', terms.zh, false),
      searchTatoeba('de', terms.de, false),
      searchTatoeba('fr', terms.fr, false),
    ]);
    const enRows = settled[0].status === 'fulfilled' ? settled[0].value : [];
    const zhRows = settled[1].status === 'fulfilled' ? settled[1].value : [];
    const deRows = settled[2].status === 'fulfilled' ? settled[2].value : [];
    const frRows = settled[3].status === 'fulfilled' ? settled[3].value : [];
    if (![enRows, zhRows, deRows, frRows].some((x) => x.length)) {
      const reason = settled.find((x) => x.status === 'rejected')?.reason?.message || '无匹配语料';
      return fallbackBundle(c, reason);
    }

    const examples = { en: [], zh: [], de: [], fr: [] };
    let bestParallel = null;
    let bestCoverage = -1;
    for (const row of enRows) {
      const tr = translationsByLang(row);
      const coverage = ['zh', 'de', 'fr'].filter((k) => tr[k].length).length;
      if (coverage > bestCoverage) { bestCoverage = coverage; bestParallel = { row, tr }; }
      if (coverage === 3) break;
    }
    if (bestParallel) {
      examples.en.push(sentenceObject(bestParallel.row, bestCoverage > 0));
      for (const key of ['zh', 'de', 'fr']) {
        if (bestParallel.tr[key][0]) examples[key].push(sentenceObject(bestParallel.tr[key][0], true));
      }
    }
    for (const row of enRows) examples.en.push(sentenceObject(row, false));
    for (const row of zhRows) examples.zh.push(sentenceObject(row, false));
    for (const row of deRows) examples.de.push(sentenceObject(row, false));
    for (const row of frRows) examples.fr.push(sentenceObject(row, false));
    for (const key of ['en', 'zh', 'de', 'fr']) {
      if (c.naturalExample[key]) examples[key].push({ text: c.naturalExample[key], id: null, lang: LANG[key].code, license: 'WordNet', owner: '', aligned: false });
      examples[key] = uniqueExamples(examples[key], 2);
    }

    const rowsByLang = { en: enRows, zh: zhRows, de: deRows, fr: frRows };
    const phrases = {};
    for (const key of ['en', 'zh', 'de', 'fr']) phrases[key] = extractPhrases(rowsByLang[key], terms[key], key);

    const preferred = { en: c.meaning.en };
    for (const key of ['zh', 'de', 'fr']) preferred[key] = preferredTerm(c, key, examples[key]);
    const completeExamples = ['en', 'zh', 'de', 'fr'].filter((k) => examples[k].length).length;
    const completePhrases = ['en', 'zh', 'de', 'fr'].filter((k) => phrases[k].length >= 2).length;
    const quality = completeExamples === 4 && completePhrases === 4 ? 'high' : completeExamples === 4 ? 'medium' : 'partial';

    return {
      version: CORPUS_CACHE_VERSION,
      builtAt: Date.now(),
      phrases,
      examples,
      preferred,
      source: 'Tatoeba 人类自然语料；同一行带“平行”时为直接翻译，其余为同词形独立语料（不冒充逐句对译或同一语境）',
      counts: { en: enRows.length, zh: zhRows.length, de: deRows.length, fr: frRows.length },
      quality,
    };
  }

  async function getNaturalBundle(c, force = false) {
    const key = corpusKey(c);
    if (!force) {
      const cached = await corpusGet(key);
      if (cached?.version === CORPUS_CACHE_VERSION) return cached;
    }
    const bundle = await buildNaturalBundle(c);
    await corpusPut(key, bundle);
    return bundle;
  }

  function tatoebaLink(id) {
    return id ? `https://tatoeba.org/en/sentences/show/${encodeURIComponent(id)}` : '';
  }

  function phrasesHTML(bundle) {
    return ['en', 'zh', 'de', 'fr'].map((key) => {
      const items = bundle.phrases[key] || [];
      const body = items.length
        ? `<div class="multiLines">${items.map((x) => `<span class="corpusEntry">${esc(x.text)}<small class="corpusMeta"><span class="evidenceTag">${x.count >= 2 ? `${x.count} 条语料重复` : '自然语料片段；未宣称高频'}</span></small></span>`).join('')}</div>`
        : '<span class="missingCorpus">暂无足够可靠的搭配证据；没有用模板短语补位。</span>';
      return `<div class="quadItem"><b>${LANG[key].label}</b>${body}</div>`;
    }).join('');
  }

  function examplesHTML(bundle) {
    return ['en', 'zh', 'de', 'fr'].map((key) => {
      const items = bundle.examples[key] || [];
      const body = items.length
        ? `<div class="multiLines">${items.map((x) => {
            const link = tatoebaLink(x.id);
            const meta = [x.aligned ? '平行翻译' : '独立自然例句（同词形）', x.owner ? `作者 ${x.owner}` : '', x.license || '', link ? `<a href="${link}" target="_blank" rel="noopener">Tatoeba #${x.id} ↗</a>` : ''].filter(Boolean).join(' · ');
            return `<span class="corpusEntry">${esc(x.text)}<small class="corpusMeta">${meta}</small></span>`;
          }).join('')}</div>`
        : '<span class="missingCorpus">暂无可靠自然例句；没有显示机器拼接句。</span>';
      return `<div class="quadItem"><b>${LANG[key].label}</b>${body}</div>`;
    }).join('');
  }

  function sourceHTML(bundle) {
    const counts = ['en', 'zh', 'de', 'fr'].map((k) => `${LANG[k].label} ${bundle.counts?.[k] || 0}`).join(' / ');
    const quality = bundle.quality === 'high' ? '四语例句与搭配均有语料' : bundle.quality === 'medium' ? '四语例句完整，部分搭配样本较少' : bundle.quality === 'fallback' ? '仅本地词网回退' : '部分语言语料不足';
    return `<span class="sourceSummary">${esc(quality)} · ${esc(counts)}<button class="sourceAction refreshCorpus" type="button">刷新语料</button></span>`;
  }

  function loadingHTML() {
    return '<div class="corpusLoading">正在检索真实人类语料、平行翻译与重复搭配；不会用模板句填空。</div>';
  }

  function bindDynamicSpeech(root = document) {
    root.querySelectorAll('.dynSpeak').forEach((b) => { b.onclick = () => speakText(b.dataset.speak, b.dataset.lang); });
  }

  async function renderBundleInto(c, bundle, where) {
    const prefix = where === 'study' ? 'study' : 'detail';
    $(`#${prefix}MeaningGrid`).innerHTML = meaningHTML(c, bundle.preferred);
    $(`#${prefix}Phrases`).innerHTML = phrasesHTML(bundle);
    $(`#${prefix}Examples`).innerHTML = examplesHTML(bundle);
    $(`#${prefix}UsageSource`).innerHTML = sourceHTML(bundle);
    $(`#${prefix}ExampleSource`).textContent = bundle.source;
    bindDynamicSpeech(where === 'study' ? $('#answer') : $('#detailBackdrop'));
    const refresh = $(`#${prefix}UsageSource .refreshCorpus`);
    if (refresh) refresh.onclick = async () => {
      refresh.disabled = true;
      refresh.textContent = '刷新中…';
      const fresh = await getNaturalBundle(c, true);
      if ((where === 'study' && current === c) || (where === 'detail' && detailCard === c)) await renderBundleInto(c, fresh, where);
      toast('自然语料已刷新');
    };
  }

  async function reveal() {
    if (!current) return;
    $('#studyMeaningGrid').innerHTML = meaningHTML(current);
    $('#studyPhrases').innerHTML = loadingHTML();
    $('#studyExamples').innerHTML = loadingHTML();
    $('#studyUsageSource').textContent = 'Tatoeba 自然语料检索中';
    $('#studyExampleSource').textContent = '首次查看需要联网，完成后自动缓存';
    $('#answer').classList.remove('hidden');
    $('#revealBtn').classList.add('hidden');
    bindDynamicSpeech($('#answer'));
    const shown = current;
    const bundle = await getNaturalBundle(shown);
    if (current === shown) await renderBundleInto(shown, bundle, 'study');
  }

  function rate(kind) {
    if (!current) return;
    const p = ensureP(current);
    const old = Math.max(0, p.interval || 0);
    let days = 0;
    if (kind === 'again') { p.streak = 0; p.reps = Math.max(0, p.reps - 1); days = 10 / (60 * 24); }
    else if (kind === 'hard') { p.streak++; p.reps++; days = old ? Math.max(1, old * 1.35) : 1; }
    else if (kind === 'good') { p.streak++; p.reps++; days = old ? Math.max(2, old * 2.35) : 2; }
    else { p.streak++; p.reps++; days = old ? Math.max(4, old * 3.2) : 4; }
    p.known = false;
    p.foundation = false;
    p.interval = Math.round(days * 100) / 100;
    p.last = Date.now();
    p.due = Date.now() + days * DAY;
    p.reviews++;
    state.reviews = (state.reviews || 0) + 1;
    p.mastered = p.reps >= state.settings.masterReps && p.streak >= 3 && p.interval >= state.settings.masterDays;
    saveState();
    qi++;
    showStudyCard();
    renderHome();
  }

  function markKnown(c = current, foundation = false) {
    if (!c) return;
    const p = ensureP(c);
    p.known = true;
    p.mastered = true;
    p.foundation = foundation;
    p.last = Date.now();
    p.due = 0;
    saveState();
    renderHome();
    if (c === current) { qi++; showStudyCard(); }
    if (detailCard === c) renderDetail(c);
  }

  function openDetail(c) {
    renderDetail(c);
  }

  async function renderDetail(c) {
    if (!c) return;
    detailCard = c;
    const p = getP(c);
    $('#detailWord').textContent = c.en;
    $('#favoriteBtn').textContent = p?.favorite ? '★' : '☆';
    $('#detailBadges').innerHTML = `<span>#${c.rank}</span><span>${esc(POS_ZH[c.pos] || c.pos)} · ${esc(c.level)}</span><span>${esc(c.band.label)}</span><span>${c.quality >= 3 ? '同概念词卡' : '对齐卡'}</span><span>${statusLabel(c)}</span>`;
    $('#detailMeaningGrid').innerHTML = meaningHTML(c);
    $('#detailPhrases').innerHTML = loadingHTML();
    $('#detailExamples').innerHTML = loadingHTML();
    $('#detailUsageSource').textContent = 'Tatoeba 自然语料检索中';
    $('#detailExampleSource').textContent = '只显示真实语料或明确标注的词网例句';
    $('#detailProgress').innerHTML = progressHTML(c);
    $('#detailKnownBtn').textContent = p?.known ? '撤销“原本已会”' : '标记原本已会';
    $('#detailRelearnBtn').textContent = p?.mastered || p?.known ? '重新加入复习' : '加入今日复习';
    $('#detailBackdrop').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    bindDynamicSpeech($('#detailBackdrop'));
    const shown = c;
    const bundle = await getNaturalBundle(shown);
    if (detailCard === shown) await renderBundleInto(shown, bundle, 'detail');
  }

  function closeDetail() {
    detailCard = null;
    $('#detailBackdrop').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function progressHTML(c) {
    const p = getP(c);
    if (!p) return '<p class="settingNote">尚未学习。你可以标记已会，或加入复习。</p>';
    const due = p.due ? new Date(p.due).toLocaleString() : '—';
    return `<div class="progressFacts"><div><b>${p.reviews || 0}</b><span>复习次数</span></div><div><b>${p.streak || 0}</b><span>连续成功</span></div><div><b>${p.interval || 0}d</b><span>当前间隔</span></div></div><p class="settingNote">状态：${statusLabel(c)} · 下次到期：${esc(due)}</p>`;
  }

  function toggleFavorite() {
    if (!detailCard) return;
    const p = ensureP(detailCard);
    p.favorite = !p.favorite;
    saveState();
    renderDetail(detailCard);
    renderSearch();
  }

  function toggleDetailKnown() {
    if (!detailCard) return;
    const p = ensureP(detailCard);
    if (p.known) {
      p.known = false;
      p.mastered = p.reviews > 0 && p.reps >= state.settings.masterReps && p.streak >= 3 && p.interval >= state.settings.masterDays;
      p.foundation = false;
    } else {
      p.known = true;
      p.mastered = true;
      p.foundation = false;
      p.last = Date.now();
      p.due = 0;
    }
    saveState();
    renderDetail(detailCard);
    renderHome();
    renderSearch();
  }

  function relearnDetail() {
    if (!detailCard) return;
    const p = ensureP(detailCard);
    p.known = false;
    p.mastered = false;
    p.foundation = false;
    p.reviews = Math.max(1, p.reviews || 0);
    p.due = Date.now();
    p.last = Date.now();
    saveState();
    renderDetail(detailCard);
    renderHome();
    renderSearch();
    toast('已加入到期复习队列');
  }

  function resetDetail() {
    if (!detailCard) return;
    if (!confirm(`重置 “${detailCard.en}” 的学习记录？`)) return;
    delete state.progress[cardId(detailCard)];
    saveState();
    renderDetail(detailCard);
    renderHome();
    renderSearch();
    toast('该词学习记录已重置');
  }

  function renderStats() {
    const s = progressStats();
    $('#statSeen').textContent = s.seen;
    $('#statMastered').textContent = s.mastered;
    $('#statReviews').textContent = state.reviews || 0;
    $('#statKnown').textContent = s.known;
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const bins = Array(7).fill(0);
    for (const p of Object.values(state.progress)) {
      if (p.known || !p.due) continue;
      const d = Math.floor((p.due - base.getTime()) / DAY);
      if (d >= 0 && d < 7) bins[d]++;
    }
    const max = Math.max(1, ...bins);
    $('#forecast').innerHTML = bins.map((n, i) => `<div><i style="height:${Math.max(5, n / max * 100)}%"></i><b>${n}</b><span>${i === 0 ? '今天' : `+${i}天`}</span></div>`).join('');
    const recent = cards.filter((c) => getP(c)?.last).sort((a, b) => getP(b).last - getP(a).last).slice(0, 8);
    $('#recentList').innerHTML = recent.length
      ? recent.map((c) => `<button class="miniItem" type="button" data-rank="${c.rank}"><b>${esc(c.en)}</b><span>${statusLabel(c)} · ${new Date(getP(c).last).toLocaleDateString()}</span></button>`).join('')
      : '<div class="empty">还没有学习记录</div>';
    $$('#recentList .miniItem').forEach((b) => { b.onclick = () => openDetail(byRank.get(Number(b.dataset.rank))); });
  }

  function loadSettingsUI() {
    const s = state.settings;
    $('#dailyNew').value = s.dailyNew;
    $('#reviewCap').value = s.reviewCap;
    $('#startBand').value = String(s.startRank);
    $('#masterReps').value = s.masterReps;
    $('#masterDays').value = s.masterDays;
    $('#pageSize').value = String(s.pageSize || 40);
    const any = Object.values(state.progress).some((p) => p.foundation);
    $('#foundationToggle').textContent = any ? '撤销核心 2,500 词“已会”标记' : '将核心 2,500 词标记为已会';
  }

  function clamp(v, a, b) {
    v = parseInt(v, 10);
    return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : a;
  }

  function saveSettingsUI() {
    state.settings.dailyNew = clamp($('#dailyNew').value, 0, 100);
    state.settings.reviewCap = clamp($('#reviewCap').value, 10, 500);
    state.settings.startRank = Number($('#startBand').value);
    state.settings.masterReps = clamp($('#masterReps').value, 3, 20);
    state.settings.masterDays = clamp($('#masterDays').value, 14, 180);
    state.settings.pageSize = Number($('#pageSize').value) || 40;
    saveState();
    renderHome();
    toast('设置已保存');
  }

  function foundationToggle() {
    const reverting = Object.values(state.progress).some((p) => p.foundation);
    let n = 0;
    if (reverting) {
      for (const c of cards.slice(0, 2500)) {
        const id = cardId(c);
        const p = state.progress[id];
        if (!p?.foundation) continue;
        p.foundation = false;
        p.known = false;
        p.mastered = false;
        if (!p.reviews && !p.favorite) delete state.progress[id];
        n++;
      }
      toast(`已撤销 ${n} 个基础词标记`);
    } else {
      for (const c of cards.slice(0, 2500)) {
        const p = getP(c);
        if (p?.reviews || p?.known || p?.mastered) continue;
        const np = ensureP(c);
        np.known = true;
        np.mastered = true;
        np.foundation = true;
        np.last = Date.now();
        n++;
      }
      toast(`已标记 ${n} 个基础词为已会`);
    }
    saveState();
    loadSettingsUI();
    renderHome();
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ app: 'LexiBridge4', schema: 4, exportedAt: new Date().toISOString(), state }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `LexiBridge4_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importData(file) {
    try {
      const d = JSON.parse(await file.text());
      if (!d?.state?.progress) throw new Error('invalid');
      const base = defaultState();
      state = { ...base, ...d.state, version: 4, settings: { ...base.settings, ...d.state.settings }, progress: d.state.progress };
      saveState();
      renderHome();
      toast('备份已导入');
    } catch {
      toast('备份文件无效');
    }
  }

  function resetAll() {
    if (!confirm('确定清空全部学习记录？词库不会删除。')) return;
    state = defaultState();
    saveState();
    applyTheme();
    renderHome();
    toast('学习记录已清空');
  }

  function speakText(text, lang) {
    if (!text || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    speechSynthesis.speak(u);
  }

  function speakTarget(id, lang) {
    speakText($(`#${id}`)?.textContent.trim(), lang);
  }

  function applyTheme() {
    const mode = state.settings.theme;
    document.documentElement.dataset.theme = mode === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
  }

  function toggleTheme() {
    state.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    saveState();
    applyTheme();
  }

  async function forceUpdate() {
    toast('正在刷新到最新版…', 2500);
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
      for (const r of regs) await r.update();
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('lexibridge4-')).map((k) => caches.delete(k)));
    } catch {
      // Continue with URL cache busting.
    }
    setTimeout(() => location.replace(`${location.pathname}?v=${Date.now()}`), 350);
  }

  function registerSW() {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js?v=8').catch(() => {});
  }

  function bind() {
    $$('[data-view]').forEach((b) => { b.onclick = () => switchView(b.dataset.view); });
    $$('[data-open-status]').forEach((b) => { b.onclick = () => openStatus(b.dataset.openStatus); });
    $('#startBtn').onclick = startStudy;
    $('#revealBtn').onclick = reveal;
    $('#endStudy').onclick = () => { switchView('homeView'); renderHome(); };
    $$('.rating button').forEach((b) => { b.onclick = () => rate(b.dataset.rate); });
    $('#knownCurrent').onclick = () => markKnown();
    $('#openStudyDetail').onclick = () => openDetail(current);

    $('#searchInput').oninput = () => { filters.page = 1; renderSearch(); };
    $('#clearSearch').onclick = () => { $('#searchInput').value = ''; filters.page = 1; renderSearch(); };
    $$('.chip').forEach((b) => {
      b.onclick = () => {
        filters.band = b.dataset.band;
        filters.page = 1;
        $$('.chip').forEach((x) => x.classList.toggle('active', x === b));
        renderSearch();
      };
    });
    for (const id of ['statusFilter', 'posFilter', 'sortFilter']) $(`#${id}`).onchange = () => { filters.page = 1; renderSearch(); };
    $('#resetFilters').onclick = resetBrowse;
    $('#prevPage').onclick = () => { filters.page = Math.max(1, filters.page - 1); renderSearch(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    $('#nextPage').onclick = () => { filters.page++; renderSearch(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    $('#pageInfo').onclick = () => {
      const arr = filteredCards();
      const pages = Math.max(1, Math.ceil(arr.length / (state.settings.pageSize || 40)));
      const v = Number(prompt(`输入页码 1–${pages}`, filters.page));
      if (v >= 1 && v <= pages) { filters.page = v; renderSearch(); }
    };
    $('#jumpRankBtn').onclick = () => {
      const v = Number(prompt('输入词库序号 1–10000'));
      const c = byRank.get(v);
      if (c) openDetail(c); else toast('序号无效');
    };

    $('#closeDetail').onclick = closeDetail;
    $('#detailBackdrop').onclick = (e) => { if (e.target === $('#detailBackdrop')) closeDetail(); };
    $('#favoriteBtn').onclick = toggleFavorite;
    $('#speakGerman').onclick = () => detailCard && speakText(detailCard.meaning.de, 'de-DE');
    $('#speakFrench').onclick = () => detailCard && speakText(detailCard.meaning.fr, 'fr-FR');
    $('#detailKnownBtn').onclick = toggleDetailKnown;
    $('#detailRelearnBtn').onclick = relearnDetail;
    $('#detailResetBtn').onclick = resetDetail;

    $('#saveSettings').onclick = saveSettingsUI;
    $('#foundationToggle').onclick = foundationToggle;
    $('#exportBtn').onclick = exportData;
    $('#importInput').onchange = (e) => e.target.files[0] && importData(e.target.files[0]);
    $('#resetBtn').onclick = resetAll;
    $('#themeBtn').onclick = toggleTheme;
    $('#updateBtn').onclick = forceUpdate;
    $$('[data-target][data-lang]').forEach((b) => { b.onclick = () => speakTarget(b.dataset.target, b.dataset.lang); });
  }

  function init() {
    applyTheme();
    bind();
    buildCards();
    switchView('homeView');
    registerSW();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
