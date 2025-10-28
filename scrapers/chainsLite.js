const CHAINS = [
  { id:'Cruz Verde', host:'www.cruzverde.cl', url:q=>`https://www.cruzverde.cl/search?q=${encodeURIComponent(q)}` },
  { id:'Ahumada', host:'www.farmaciasahumada.cl', url:q=>`https://www.farmaciasahumada.cl/search?q=${encodeURIComponent(q)}` },
  { id:'Salcobrand', host:'salcobrand.cl', url:q=>`https://salcobrand.cl/search?type=product&q=${encodeURIComponent(q)}` },
  { id:'Farmaexpress', host:'farmex.cl', url:q=>`https://farmex.cl/search?q=${encodeURIComponent(q)}` },
  { id:'Dr. Simi', host:'www.drsimi.cl', url:q=>`https://www.drsimi.cl/catalogsearch/result/?q=${encodeURIComponent(q)}` }
];

const SYNONYMS = {
  'clotiazepam': ['clotiazepam','neuroval','planiden','rize','valpinax'],
  'ketoprofeno': ['ketoprofeno','ketoprofen','profenid'],
  'paracetamol': ['paracetamol','acetaminofen','acetaminophen']
};

function mkMapsUrl(chain, lat=null, lng=null){
  const base='https://www.google.com/maps/dir/?api=1';
  const dest=encodeURIComponent('Farmacia '+chain);
  if(lat!=null && lng!=null) return `${base}&destination=${dest}&origin=${lat},${lng}&travelmode=driving`;
  return `${base}&destination=${dest}&travelmode=driving`;
}

function parsePriceText(s){
  if(!s) return null;
  s = s.replace(/\u00A0/g,' ');
  const m = s.match(/(?:clp\s*)?\$?\s*([\d\.\,]{3,})/i);
  if(!m) return null;
  const n = parseInt(m[1].replace(/[^\d]/g,''),10);
  if(!Number.isFinite(n) || n < 500 || n > 30000) return null;
  return n;
}

function normalize(str){
  return (str||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
}

function getTokens(q){
  const base = normalize(q).split(/\s+/).filter(Boolean);
  const key = base.join(' ');
  let extras = [];
  for(const k of Object.keys(SYNONYMS)){
    if(key.includes(k)) { extras = SYNONYMS[k]; break; }
  }
  const set = new Set([ ...base, ...extras.map(normalize) ]);
  return Array.from(set).filter(Boolean);
}

function looksRelevantNameUrl(nameOrUrl, tokens){
  const n = normalize(nameOrUrl);
  return tokens.some(t => n.includes(t));
}

async function fetchText(url){
  const prox = 'https://r.jina.ai/' + url.replace(/^https?:\/\//,'');
  const res = await fetch(prox, { headers: { 'User-Agent':'Mozilla/5.0', 'Accept-Language':'es-CL,es;q=0.9,en;q=0.8' } });
  return await res.text();
}

function isProductUrl(u, host){
  try{
    const url = new URL(u);
    const h = url.host.replace(/^www\./,'');
    const hh = host.replace(/^www\./,'');
    if(h !== hh) return false;
    const p = url.pathname.toLowerCase();
    if(!p || p === '/') return false;
    if(p.includes('cdn/') || p.endsWith('.webp') || p.endsWith('.jpg') || p.endsWith('.png')) return false;
    const bad = ['club-bebe','pages','collections','category','blog','catalogsearch','search','patologias','promociones','dermocosmetica'];
    if(bad.some(b => p.includes('/'+b))) return false;
    const good = ['products','product','producto','productos','/p/','/prod/','/sku/'];
    if (good.some(g => p.includes(g))) return true;
    if (p.endsWith('.html')) return true;
    if (p.split('/').length >= 3 && /\d/.test(p)) return true;
    return false;
  }catch{ return false; }
}

function fromJsonLd(text, sourceId, tokens){
  const items = [];
  const re = /"@type"\s*:\s*"Product"[\s\S]*?("name"\s*:\s*"([^"]+)")?[\s\S]*?("url"\s*:\s*"([^"]+)")?[\s\S]*?("price"\s*:\s*"?(?<price>[\d\.\,]+)"?)/ig;
  let m;
  while((m = re.exec(text))){
    const name = m[2] || '';
    const url  = m[4] || '';
    const price = parsePriceText(m.groups?.price || '');
    if(!name || !url || !price) continue;
    if(!looksRelevantNameUrl(name+' '+url, tokens)) continue;
    items.push({ source: sourceId, name, url, price });
    if(items.length>=60) break;
  }
  return items;
}

function fromDomLite(text, host, sourceId, tokens){
  const items = [];
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    const urls = lines[i].match(/https?:\/\/[^\s\)\]]+/g) || [];
    if(!urls.length) continue;
    let win = '';
    for(let k=i-6;k<=i+6;k++){ if(k>=0 && k<lines.length) win += ' ' + lines[k]; }
    const price = parsePriceText(win);
    if(!price) continue;
    for(const raw of urls){
      try{
        const url = new URL(raw).toString();
        if(!isProductUrl(url, host)) continue;
        const name = (lines[i-1] || lines[i] || '').slice(0,180);
        if(!looksRelevantNameUrl(name+' '+url, tokens)) continue;
        items.push({ source: sourceId, name, url, price });
      }catch{}
    }
    if(items.length>=80) break;
  }
  const seen = new Set();
  return items.filter(it=>{
    const k = it.url.split('?')[0];
    if(seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function fetchChainMin(chain, q, tokens, lat, lng){
  const url = chain.url(q);
  const text = await fetchText(url).catch(()=> '');
  if(!text) return null;

  let items = fromJsonLd(text, chain.id, tokens);
  if(!items.length) items = fromDomLite(text, chain.host, chain.id, tokens);

  if(!items.length) return null;
  items.sort((a,b)=>a.price-b.price);
  const best = items[0];
  return {
    chain: chain.id,
    price: best.price,
    url: best.url.startsWith('http') ? best.url : `https://${chain.host}${best.url}`,
    mapsUrl: mkMapsUrl(chain.id, lat, lng)
  };
}

export async function searchChainPricesLite(q,{lat=null,lng=null}={}){
  const tokens = getTokens(q);
  const results = [];
  for(const c of CHAINS){
    const it = await fetchChainMin(c, q, tokens, lat, lng).catch(()=>null);
    if(it) results.push(it);
  }
  const byChain = new Map();
  for(const it of results){
    const prev = byChain.get(it.chain);
    if(!prev || it.price < prev.price) byChain.set(it.chain, it);
  }
  const items = Array.from(byChain.values()).sort((a,b)=>a.price-b.price);
  return { ok:true, query:q, count: items.length, items };
}
