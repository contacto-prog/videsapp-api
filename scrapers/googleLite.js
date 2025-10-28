const HOST_TO_CHAIN = {
  'www.cruzverde.cl':'Cruz Verde','cruzverde.cl':'Cruz Verde',
  'www.farmaciasahumada.cl':'Ahumada','farmaciasahumada.cl':'Ahumada',
  'salcobrand.cl':'Salcobrand','www.salcobrand.cl':'Salcobrand',
  'farmex.cl':'Farmaexpress','www.farmex.cl':'Farmaexpress',
  'drsimi.cl':'Dr. Simi','www.drsimi.cl':'Dr. Simi'
};

const DOMAINS = [
  'cruzverde.cl',
  'farmaciasahumada.cl',
  'salcobrand.cl',
  'farmex.cl',
  'drsimi.cl'
];

function unwrapGoogleUrl(u){
  try{
    const url = new URL(u);
    if(url.host.includes('google.') && url.pathname.startsWith('/url')){
      const q = url.searchParams.get('q');
      if(q) return q;
    }
  }catch{}
  return u;
}

function isProductish(u){
  try{
    const {pathname} = new URL(u);
    if(!pathname || pathname === '/' ) return false;
    const p = pathname.toLowerCase();
    const bad = ['/','/search','/catalogsearch','/categoria','/category','/collections','/pages','/blog'];
    if (bad.some(b => p === b || p.startsWith(b+'/'))) return false;
    const good = ['product','products','producto','productos','/p/','/prod/','/sku/'];
    return good.some(g => p.includes(g)) || /\d/.test(p) || p.includes('.html') || p.split('/').length >= 3;
  }catch{ return false; }
}

function parsePrice(text){
  if(!text) return null;
  text = text.replace(/\u00A0/g,' ');
  const pats = [
    /(?:clp\s*)?\$\s*([\d\.\,]{3,})/i,
    /\bprecio[:\s]*\$?\s*([\d\.\,]{3,})/i,
    /\b([\d\.]{3,})\s*clp\b/i
  ];
  for(const re of pats){
    const m = text.match(re);
    if(m){
      const n = parseInt(String(m[1]).replace(/[^\d]/g,''),10);
      if(Number.isFinite(n) && n>=200 && n<=1000000) return n;
    }
  }
  return null;
}

function mkMapsUrl(chain, lat=null, lng=null){
  const base='https://www.google.com/maps/dir/?api=1';
  const dest=encodeURIComponent('Farmacia '+chain);
  if(lat!=null && lng!=null) return `${base}&destination=${dest}&origin=${lat},${lng}&travelmode=driving`;
  return `${base}&destination=${dest}&travelmode=driving`;
}

async function fetchText(url){
  const res = await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept-Language':'es-CL,es;q=0.9,en;q=0.8'}});
  return await res.text();
}

function extractUrlsFromSerpText(text, domain){
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const out = [];
  for(const line of lines){
    const ms = line.match(/https?:\/\/[^\s\)\]]+/g);
    if(!ms) continue;
    for(const raw of ms){
      const u = unwrapGoogleUrl(raw);
      try{
        const h = new URL(u).host.replace(/^www\./,'');
        if(h.endsWith(domain.replace(/^www\./,'')) && isProductish(u)) out.push(u);
      }catch{}
    }
  }
  return Array.from(new Set(out));
}

function findBestPriceOnPage(text){
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  let best = null;
  for(const s of lines){
    const p = parsePrice(s);
    if(p!=null) best = best==null ? p : Math.min(best,p);
  }
  return best;
}

async function searchOneDomain(q, domain, lat, lng){
  const base = 'https://r.jina.ai/http://www.google.com/search';
  const qstr = `${q} precio site:${domain}`;
  const serpUrl = `${base}?q=${encodeURIComponent(qstr)}&hl=es-CL&num=10`;
  const serp = await fetchText(serpUrl).catch(()=>'');

  const urls = extractUrlsFromSerpText(serp, domain).slice(0,3);
  for(const u of urls){
    const pageUrl = (u.startsWith('http') ? u : 'https://'+u);
    const proxy = 'https://r.jina.ai/' + (pageUrl.startsWith('http') ? pageUrl.replace(/^https?:\/\//,'') : pageUrl);
    const pageText = await fetchText(proxy).catch(()=>'');

    const price = findBestPriceOnPage(pageText);
    if(price!=null){
      let host=''; try{ host=new URL(pageUrl).host; }catch{}
      const chain = HOST_TO_CHAIN[host] || HOST_TO_CHAIN[host.replace(/^www\./,'')] || null;
      if(chain){
        return { chain, price, url: pageUrl, mapsUrl: mkMapsUrl(chain, lat, lng) };
      }
    }
  }
  return null;
}

export async function searchGooglePricesLite(q,{lat=null,lng=null}={}){
  const items = [];
  for(const domain of DOMAINS){
    const it = await searchOneDomain(q, domain, lat, lng).catch(()=>null);
    if(it) items.push(it);
  }
  const byChain = new Map();
  for(const it of items){
    const prev = byChain.get(it.chain);
    if(!prev || it.price < prev.price) byChain.set(it.chain, it);
  }
  const uniq = Array.from(byChain.values()).sort((a,b)=>a.price-b.price);
  return {ok:true, query:q, count: uniq.length, items: uniq};
}
