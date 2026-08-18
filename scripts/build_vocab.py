#!/usr/bin/env python3
"""Build LexiBridge 10k EN/ZH/DE/FR vocabulary cards.

Quality invariants:
- English card heads are canonical single-word WordNet lemmas, not incidental
  inflected surface forms from the frequency corpus.
- EN/ZH/DE/FR heads all come from the SAME WordNet/ILI concept.
- When a concept has multiple translated lemmas, a broad frequency corpus is
  used only to choose the most ordinary lemma inside that concept; it never
  substitutes a translation from another sense.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import requests
import wn

TARGET = 10_000
OUT = Path('vocab')
OUT.mkdir(exist_ok=True)

TOPICS = [
    '动作、变化与关系','描述、性质与评价','通用概念与实体','心理与行为',
    '空间、时间与数量','研究与证据','健康、身体与医学','经济与组织',
    '方式、程度与逻辑','社会、法律与政治','自然与环境','语言、文化与艺术',
    '科学与技术','评价与质量','通用学术词汇','系统与过程','社会、制度与资源',
    '方法与推理','时间与情境','数据与测量','沟通与认知','变化与发展','因果与影响',
]
POS_CODE={'n':0,'v':1,'a':2,'s':2,'r':3}
WORD_RE=re.compile(r"^[A-Za-z][A-Za-z'-]{1,34}$")
BAD={'fuck','fucking','shit','bitch','ass','cunt','dick','porn'}
LEXICONS={'zh':'omw-cmn:1.4','de':'odenet:1.4','fr':'omw-fr:1.4'}
FREQ_URLS={
    'en':'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt',
    'zh':'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/zh_cn/zh_cn_50k.txt',
    'de':'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt',
    'fr':'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/fr/fr_50k.txt',
}


def download_wordnets():
    for spec in ('omw-en:1.4','omw-cmn:1.4','omw-fr:1.4','odenet:1.4'):
        print('Installing',spec,flush=True)
        try: wn.download(spec)
        except Exception as exc: print('download note:',spec,exc,file=sys.stderr)


def frequency_table(lang):
    resp=requests.get(FREQ_URLS[lang],timeout=90);resp.raise_for_status()
    ordered=[];rank={};count={}
    for line in resp.text.splitlines():
        try: token,n=line.rsplit(' ',1); n=int(n)
        except Exception: continue
        token=token.strip();key=token.casefold()
        if not token or key in rank: continue
        if lang=='en' and (not WORD_RE.match(token) or key in BAD): continue
        rank[key]=len(rank)+1;count[key]=n;ordered.append(token.lower() if lang=='en' else token)
    return ordered,rank,count


def clean_lemma(value,lang):
    x=str(value).replace('_',' ').strip()
    if lang=='zh': x=x.replace('+','').strip()
    if not x or len(x)>80:return None
    if lang=='en':
        x=x.lower()
        if ' ' in x or not WORD_RE.match(x) or x in BAD:return None
    return x


def unique(seq):
    out=[];seen=set()
    for x in seq:
        if not x:continue
        k=x.casefold()
        if k in seen:continue
        seen.add(k);out.append(x)
    return out


def ranked_lemmas(synsets,lang,rankmap):
    vals=[]
    for ss in synsets:
        try: vals.extend(clean_lemma(x,lang) for x in ss.lemmas())
        except Exception: pass
    vals=unique([x for x in vals if x])
    return sorted(vals,key=lambda x:(rankmap.get(x.casefold(),10**9),len(x),x.casefold()))


def synset_bundle(ss,lang,rankmap):
    try: translated=ss.translate(lexicon=LEXICONS[lang]) or []
    except Exception:return None
    lemmas=ranked_lemmas(translated,lang,rankmap)
    if not lemmas:return None
    examples=[]
    for tss in translated:
        try: examples.extend(str(x).strip() for x in (tss.examples() or []))
        except Exception: pass
    examples=unique([x for x in examples if x and len(x)<=240])
    return {'head':lemmas[0],'related':lemmas[1:5],'example':examples[0] if examples else ''}


def english_lemmas(ss,en_rank):
    try: vals=[clean_lemma(x,'en') for x in ss.lemmas()]
    except Exception:return []
    vals=unique([x for x in vals if x])
    return sorted(vals,key=lambda x:(en_rank.get(x,10**9),len(x),x))


def examples(ss):
    try: vals=ss.examples() or []
    except Exception: vals=[]
    return unique([str(x).strip() for x in vals if str(x).strip() and len(str(x).strip())<=240])[:2]


def choose_aligned(en,query,ranks):
    try: synsets=en.synsets(query)
    except Exception:return None
    for ss in synsets:
        if ss.pos not in POS_CODE:continue
        en_ls=english_lemmas(ss,ranks['en'])
        if not en_ls:continue
        q=query.casefold();head=query if q in {x.casefold() for x in en_ls} else en_ls[0]
        head=clean_lemma(head,'en')
        if not head:continue
        bundles={lang:synset_bundle(ss,lang,ranks[lang]) for lang in ('zh','de','fr')}
        if all(bundles.values()):return ss,head,en_ls,bundles
    return None


def level_code(rank):
    if rank<=1500:return 0
    if rank<=3000:return 1
    if rank<=5000:return 2
    if rank<=7000:return 3
    if rank<=8500:return 4
    return 5


def topic_code(defn,pos):
    s=defn.lower();rules=[
        (6,('disease','medical','body','health','blood','tissue','organ')),
        (12,('science','technology','computer','chemical','physics','energy')),
        (5,('research','evidence','theory','hypothesis','study','experiment')),
        (7,('economic','money','business','company','trade','market')),
        (9,('law','political','government','legal','state','authority')),
        (10,('plant','animal','environment','earth','natural','species')),
        (11,('language','music','art','literature','speech','writing')),
        (19,('measure','amount','quantity','data','number','rate')),
        (20,('think','know','communicat','understand','belief','memory')),
        (22,('cause','effect','influence','result','consequence')),
        (21,('develop','change','increase','decrease','grow','transform')),
        (4,('time','space','distance','location','period','position')),
    ]
    for code,keys in rules:
        if any(k in s for k in keys):return code
    if pos=='v':return 0
    if pos in {'a','s','r'}:return 1
    return 2


def undesirable(word,definition):
    if len(word)<=1:return True
    d=definition.lower()
    if any(x in d for x in ('capital of the ','city in ','town in ','river in ','state capital','surname')):return True
    return False


def main():
    started=time.time();download_wordnets();en=wn.Wordnet('omw-en:1.4')
    tables={};ranks={};counts={}
    for lang in ('en','zh','de','fr'):
        tables[lang],ranks[lang],counts[lang]=frequency_table(lang)
    candidates=list(tables['en'])
    extra=[]
    for w in en.words():
        lemma=clean_lemma(w.lemma(),'en')
        if lemma and lemma not in ranks['en']:extra.append(lemma)
    candidates.extend(sorted(set(extra)))

    rows=[];seen=set();strict_misses=0;canonicalized=0
    for query in candidates:
        if len(rows)>=TARGET:break
        chosen=choose_aligned(en,query,ranks)
        if chosen is None:strict_misses+=1;continue
        ss,head,en_ls,bundles=chosen
        if head in seen:continue
        try:defn=(ss.definition() or '').strip()
        except Exception:defn=''
        if not defn or undesirable(head,defn):continue
        if head!=query:canonicalized+=1
        rank=len(rows)+1
        f_rank=ranks['en'].get(head,ranks['en'].get(query))
        f_count=counts['en'].get(head,counts['en'].get(query))
        ex=examples(ss)
        related=[x for x in en_ls if x!=head][:5]
        rows.append([
            head,POS_CODE.get(ss.pos,0),level_code(rank),topic_code(defn,ss.pos),defn,
            bundles['zh']['head'],bundles['de']['head'],bundles['fr']['head'],f_rank,f_count,
            str(getattr(ss,'id',rank)),3,ex[0] if ex else '',bundles['zh']['example'],
            bundles['de']['example'],bundles['fr']['example'],related,bundles['zh']['related'],
            bundles['de']['related'],bundles['fr']['related'],query if query!=head else ''
        ])
        seen.add(head)
        if rank%500==0:print(f'accepted {rank}/{TARGET}: {head}',flush=True)
    if len(rows)!=TARGET:
        raise SystemExit(f'Could build only {len(rows)} strict canonical cards; refusing degraded fallback')

    for old in OUT.glob('part-*.js'):old.unlink()
    for i in range(0,TARGET,1000):
        payload=json.dumps(rows[i:i+1000],ensure_ascii=False,separators=(',',':'))
        (OUT/f'part-{i//1000:02d}.js').write_text('window.LB4_ROWS=window.LB4_ROWS||[];window.LB4_ROWS.push(...'+payload+');\n',encoding='utf-8')
    (OUT/'meta.js').write_text('window.LB4_TOPICS='+json.dumps(TOPICS,ensure_ascii=False,separators=(',',':'))+';window.LB4_ROWS=[];window.LB4_SCHEMA=3;\n',encoding='utf-8')
    audit={
        'cards':len(rows),'uniqueEnglish':len(seen),'shards':10,'schema':3,
        'canonicalEnglishLemmas':True,'surfaceFormsCanonicalized':canonicalized,
        'strictSameConceptAllFourLanguages':True,'independentBilingualFallbacks':False,
        'translationHeadFrequencyRankedWithinSameConcept':True,'strictMissesBeforeTarget':strict_misses,
        'frequencyRanked':sum(1 for r in rows if r[8] is not None),
        'naturalEnglishExampleCards':sum(1 for r in rows if r[12]),
        'naturalZhExampleCards':sum(1 for r in rows if r[13]),
        'naturalDeExampleCards':sum(1 for r in rows if r[14]),
        'naturalFrExampleCards':sum(1 for r in rows if r[15]),
        'sources':['omw-en:1.4','omw-cmn:1.4','omw-fr:1.4','odenet:1.4','FrequencyWords EN/ZH/DE/FR'],
        'seconds':round(time.time()-started,1),
    }
    (OUT/'BUILD_AUDIT.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(audit,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
