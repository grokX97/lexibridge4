const ALLOWED_ORIGIN = 'https://grokx97.github.io';
const WORD_RE = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{0,79}$/;

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  return origin;
}

function systemPrompt() {
  return `你是严苛的中英德法四语词典主编。用户是中文母语者，学习英语、德语、法语。任务是为一个英文词建立“多义项、概念中心”的学习包，而不是机械翻译。\n\n硬规则：\n1. 先识别该英文词最常见、最有学习价值的 1-4 个义项，按实际常用程度排序；冷僻义不得抢占主义项。\n2. 每个义项必须给自然、通俗、中文母语者一看就懂的中文解释；禁止用生硬词典腔替代解释。\n3. 每个义项分别给英语 lemma、自然德语对应、自然法语对应；允许结构不同，但语义必须一致。\n4. 每个义项分别列：三语词形/语法、词族、5-7 组同义/近义表达及差异、3-5 组反义/对立表达、10-14 组高价值常用搭配、6 组四语平行例句、3-6 条易混点/语域/介词限制。\n5. 所有“可比较内容”的每一行必须同时包含 zh/en/de/fr 四列，并表达同一功能或同一情境。\n6. 搭配必须自然高频、有现实学习价值；不要模板化，不要硬译。\n7. 例句必须是同一情境的自然四语平行表达，英语、德语、法语均自然使用目标词或正确变形。\n8. 多义词必须分义项组织，禁止把所有内容揉成一个释义。\n9. 若基础词典信息与常用意义冲突，以现代常用义和自然中文为准，并在 notesZh 说明。\n10. 只输出合法 JSON。`;
}

function userPrompt(word, base) {
  return `目标英文词：${word}\n基础线索（仅供参考，可能不准）：${JSON.stringify(base || {})}\n\n输出 JSON 结构：\n{\n  "word":"",\n  "senses":[{\n    "rank":1,\n    "pos":"",\n    "frequencyLabel":"核心义/常用义/次常用义",\n    "zhDefinition":"",\n    "enDefinition":"",\n    "headwords":{"en":"","de":"","fr":""},\n    "forms":{"en":[{"label":"","form":""}],"de":[{"label":"","form":""}],"fr":[{"label":"","form":""}]},\n    "families":[{"functionZh":"","zh":"","en":"","de":"","fr":""}],\n    "synonyms":[{"nuanceZh":"","differenceZh":"","zh":"","en":"","de":"","fr":""}],\n    "antonyms":[{"functionZh":"","zh":"","en":"","de":"","fr":""}],\n    "collocations":[{"functionZh":"","zh":"","en":"","de":"","fr":"","register":"","noteZh":""}],\n    "examples":[{"scenarioZh":"","zh":"","en":"","de":"","fr":"","noteZh":""}],\n    "usageNotes":[""],\n    "notesZh":""\n  }],\n  "audit":{"reviewed":true,"warnings":[],"summaryZh":""}\n}`;
}

export default async function handler(req, res) {
  const origin = cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'METHOD_NOT_ALLOWED' });
  if (origin && origin !== ALLOWED_ORIGIN) return res.status(403).json({ ok:false, error:'ORIGIN_NOT_ALLOWED' });
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return res.status(500).json({ ok:false, error:'DEEPSEEK_API_KEY_MISSING' });

  const word = String(req.body?.word || '').trim();
  if (!WORD_RE.test(word)) return res.status(400).json({ ok:false, error:'INVALID_WORD' });
  const base = req.body?.base && typeof req.body.base === 'object' ? req.body.base : {};

  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${key}`},
      body:JSON.stringify({
        model:'deepseek-v4-flash',
        messages:[
          {role:'system', content:systemPrompt()},
          {role:'user', content:userPrompt(word, base)}
        ],
        response_format:{type:'json_object'},
        temperature:0.15,
        max_tokens:12000
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ ok:false, error:data?.error?.message || 'DEEPSEEK_REQUEST_FAILED' });
    const text = data?.choices?.[0]?.message?.content;
    if (!text) return res.status(502).json({ ok:false, error:'EMPTY_MODEL_RESPONSE' });
    let pack;
    try { pack = JSON.parse(text); } catch { return res.status(502).json({ ok:false, error:'INVALID_JSON_FROM_MODEL' }); }
    return res.status(200).json({ ok:true, model:'deepseek-v4-flash', pack });
  } catch {
    return res.status(502).json({ ok:false, error:'DEEPSEEK_UNREACHABLE' });
  }
}
