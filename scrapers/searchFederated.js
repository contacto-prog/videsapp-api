// scrapers/searchFederated.js – federado top-1 (filtra categorías y valida producto real)
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';

const TTL_MS = 1000 * 60 * 10; // 10 minutos
const CACHE = new Map();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36';

const priceRx = /\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/;
const toPrice = (s)=> s ? Number(s.replace(/\$/g,'').replace(/\./g,'').replace(',','.')) : undefined;
const looksLikeCategory = (s)=> /medicamentos|productos\s+m[aá]s|categor[ií]a|resultados|suscr[ií]bete|promo|descuento/i.test(s||'');

function setCache(k, v){ CACHE.set(k, {v, t: Date.now()}); }
function getCache(k){ const e = CACHE.get(k); if(!e) return null; if(Date.now()-e.t>TTL_MS){CACHE.delete(k); return null;} return e.v; }
function withTimeout(p, ms){
  return new Promise((res,rej)=>{
    const t = setTimeout(()=>rej(new Error(`timeout_${ms}ms`)), ms);
    p.then(x=>{ clearTimeout(t); res(x); }, e=>{ clearTimeout(t); rej(e); });
  });
}

async function getText(url){
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language':'es-CL,es;q=0.9' }});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

function norm({source,url,name,price,availability}){
  return {
    source,
    url,
    name: (name||'').replace(/\s+/g,' ').trim().slice(0,160),
    price: typeof price==='number' && Number.isFinite(price) ? price : undefined,
    availability: availability || 'unknown'
  };
}

async function withBrowser(run){
  const browser = await puppeteer.launch({
    headless:'new',
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
  });
  try { return await run(browser); }
  finally { await browser.close().catch(()=>{}); }
}

// ---------- scoring / validación ----------
function scoreByQuery(name, q) {
  const nq = (q||'').toLowerCase();
  const nn = (name||'').toLowerCase();
  if (!nn || !nq) return 0;
  let score = 0;
  if (nn.includes(nq)) score += 3;
  const toks = nq.split(/\s+/).filter(Boolean);
  for (const t of toks) if (nn.includes(t)) score += 1;
  return score;
}
function acceptCandidate({title, price}, q){
  if (!title) return false;
  if (looksLikeCategory(title)) return false;
  const score = scoreByQuery(title, q);
  // exigimos coincidencia mínima y precio presente
  return score >= 2 && typeof price === 'number' && Number.isFinite(price) && price > 0;
}

// ---------- extrae de la PÁGINA DE PRODUCTO (no del listado) ----------
async function extractFromProductPage(url){
  const html = await getText(url);
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim()
             || $('[itemprop="name"]').first().text().trim()
             || $('meta[property="og:title"]').attr('content')
             || $('title').text().trim();
  const blob = $('body').text();
  const priceTxt = $('[class*="price"], .price, .product__price, [itemprop="price"]').first().text()
                 || blob.match(priceRx)?.[0]
                 || '';
  const availability =
    /Agregar al carro|Añadir al carrito|Disponible/i.test(blob) ? 'in_stock' :
    (/Agotado|No disponible|Sin stock/i.test(blob) ? 'out_of_stock' : 'unknown');
  return { title, price: toPrice(priceTxt), availability };
}

// ---------- Site: Salcobrand (sin navegador) ----------
async function top1Salcobrand(q){
  const searchUrl = `https://salcobrand.cl/search?q=${encodeURIComponent(q)}`;
  const html = await getText(searchUrl);
  const $ = cheerio.load(html);
  const cand = [];
  $('a').each((_,a)=>{
    const href = $(a).attr('href')||'';
    if (!/\/products\//i.test(href) || href.includes('#')) return;
    const abs = new URL(href, searchUrl).toString();
    const name = ($(a).text() || $(a).closest('div').text() || '').trim();
    if (looksLikeCategory(name)) return;
    cand.push({ url: abs, name });
  });
  const picked = [];
  for (const c of cand.slice(0,6)) {
    try {
      const d = await extractFromProductPage(c.url);
      picked.push({ ...c, ...d, score: scoreByQuery(d.title||c.name, q) });
      if (acceptCandidate({title:d.title, price:d.price}, q)) {
        return [ norm({ source:'salcobrand', url:c.url, name:d.title||c.name, price:d.price, availability:d.availability }) ];
      }
    } catch {}
  }
  return [];
}

// ---------- Site: Dr. Simi (sin navegador) ----------
async function top1DrSimi(q){
  const searchUrl = `https://www.drsimi.cl/catalogsearch/result/?q=${encodeURIComponent(q)}`;
  const html = await getText(searchUrl);
  const $ = cheerio.load(html);
  const cand = [];
  $('a').each((_,a)=>{
    const href = $(a).attr('href')||'';
    if (!(/\/p($|[\/\?])|\/producto|\/product/i.test(href)) || href.includes('#')) return;
    const abs = new URL(href, searchUrl).toString();
    const name = ($(a).text() || $(a).closest('li,div').text() || '').trim();
    if (looksLikeCategory(name)) return;
    cand.push({ url: abs, name });
  });
  const picked = [];
  for (const c of cand.slice(0,6)) {
    try {
      const d = await extractFromProductPage(c.url);
      picked.push({ ...c, ...d, score: scoreByQuery(d.title||c.name, q) });
      if (acceptCandidate({title:d.title, price:d.price}, q)) {
        return [ norm({ source:'drsimi', url:c.url, name:d.title||c.name, price:d.price, availability:d.availability }) ];
      }
    } catch {}
  }
  return [];
}

// ---------- Site: Farmex (Shopify, sin navegador) ----------
async function top1Farmex(q){
  const searchUrl = `https://farmex.cl/search?q=${encodeURIComponent(q)}`;
  const html = await getText(searchUrl);
  const $ = cheerio.load(html);
  const cand = [];
  $('a').each((_,a)=>{
    const href = $(a).attr('href')||'';
    if (!/\/products\//i.test(href) || href.includes('#')) return;
    const abs = new URL(href, searchUrl).toString();
    const name = ($(a).text() || $(a).closest('div').text() || '').trim();
    if (looksLikeCategory(name)) return;
    cand.push({ url: abs, name });
  });
  // prioriza coincidencias con la query para evitar "Kyleena" en búsquedas como "paracetamol"
  cand.sort((a,b)=> scoreByQuery(b.name, q) - scoreByQuery(a.name, q));
  const picked = [];
  for (const c of cand.slice(0,8)) {
    try {
      const d = await extractFromProductPage(c.url);
      picked.push({ ...c, ...d, score: scoreByQuery(d.title||c.name, q) });
      if (acceptCandidate({title:d.title, price:d.price}, q)) {
        return [ norm({ source:'farmex', url:c.url, name:d.title||c.name, price:d.price, availability:d.availability }) ];
      }
    } catch {}
  }
  return [];
}

// ---------- Site: Ahumada (con navegador) ----------
async function top1Ahumada(q){
  return await withBrowser(async (browser)=>{
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language':'es-CL,es;q=0.9' });

    const searchUrl = `https://www.farmaciasahumada.cl/search?q=${encodeURIComponent(q)}`;
    await page.goto(searchUrl, { waitUntil:'networkidle2', timeout:60000 });

    const cand = await page.evaluate(()=>{
      const out=[];
      for (const a of Array.from(document.querySelectorAll('a'))) {
        const href = a.getAttribute('href')||'';
        if (/\/product|\/products|\/medicamento|\/producto/i.test(href) && !href.includes('#')) {
          try { out.push({ url: new URL(href, location.href).toString(), name: a.textContent?.trim() || '' }); } catch {}
        }
      }
      return out;
    });

    for (const c of cand.slice(0,6)) {
      try {
        await page.goto(c.url, { waitUntil:'networkidle2', timeout:60000 });
        const row = await page.evaluate((priceReStr)=>{
          const priceRe = new RegExp(priceReStr);
          const pick = (sel)=> document.querySelector(sel)?.textContent?.trim() || null;
          const title = pick('h1') || pick('[itemprop="name"]') || document.title;
          const priceTxt = pick('[class*="price"]') || pick('.price') || (document.body.innerText.match(priceRe)||[])[0] || '';
          const availability = /Agregar al carro|Añadir al carrito|Disponible/i.test(document.body.innerText)
            ? 'in_stock' : (/Agotado|No disponible|Sin stock/i.test(document.body.innerText) ? 'out_of_stock' : 'unknown');
          return { title, priceTxt, availability };
        }, priceRx.source);
        const d = { title: row.title, price: toPrice(row.priceTxt), availability: row.availability };
        if (acceptCandidate(d, q)) {
          return [ norm({ source:'ahumada', url:c.url, name:d.title||c.name, price:d.price, availability:d.availability }) ];
        }
      } catch {}
    }
    return [];
  });
}

// ---------- Site: Cruz Verde (con navegador) ----------
async function top1CruzVerde(q){
  return await withBrowser(async (browser)=>{
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language':'es-CL,es;q=0.9' });

    const searchUrl = `https://www.cruzverde.cl/search?q=${encodeURIComponent(q)}`;
    await page.goto(searchUrl, { waitUntil:'networkidle2', timeout:60000 });

    const cand = await page.evaluate(()=>{
      const out=[];
      for (const a of Array.from(document.querySelectorAll('a'))) {
        const href = a.getAttribute('href')||'';
        if ( (/\d+\.html$/i.test(href) || /\/product|\/products|\/producto/i.test(href)) && !href.includes('#')) {
          try { out.push({ url: new URL(href, location.href).toString(), name: a.textContent?.trim() || '' }); } catch {}
        }
      }
      return out;
    });

    for (const c of cand.slice(0,8)) {
      try {
        await page.goto(c.url, { waitUntil:'networkidle2', timeout:60000 });
        const row = await page.evaluate((priceReStr)=>{
          const priceRe = new RegExp(priceReStr);
          const pick = (sel)=> document.querySelector(sel)?.textContent?.trim() || null;
          const title = pick('h1') || pick('[itemprop="name"]') || document.title;
          const priceTxt = pick('[class*="price"]') || pick('.price') || (document.body.innerText.match(priceRe)||[])[0] || '';
          const availability = /Agregar al carro|Añadir al carrito|Disponible/i.test(document.body.innerText)
            ? 'in_stock' : (/Agotado|No disponible|Sin stock/i.test(document.body.innerText) ? 'out_of_stock' : 'unknown');
          return { title, priceTxt, availability };
        }, priceRx.source);
        const d = { title: row.title, price: toPrice(row.priceTxt), availability: row.availability };
        if (acceptCandidate(d, q)) {
          return [ norm({ source:'cruzverde', url:c.url, name:d.title||c.name, price:d.price, availability:d.availability }) ];
        }
      } catch {}
    }
    return [];
  });
}

// ---------- Orquestador ----------
export async function federatedSearchTop1(q, opts={}){
  const key = (q||'').trim().toLowerCase();
  const debug = !!opts.debug;
  if(!key) throw new Error('q_required');

  const cached = !debug && getCache(key);
  if(cached) return cached;

  const tasks = [
    withTimeout(top1Salcobrand(key), 15000).catch(()=>[]),
    withTimeout(top1DrSimi(key),     15000).catch(()=>[]),
    withTimeout(top1Farmex(key),     15000).catch(()=>[]),
    withTimeout(top1Ahumada(key),    22000).catch(()=>[]),
    withTimeout(top1CruzVerde(key),  22000).catch(()=>[]),
  ];

  const settled = await Promise.allSettled(tasks);
  const items = settled.flatMap(s => s.status==='fulfilled' ? s.value : []);
  const result = { ok:true, q:key, count: items.length, items };
  if (!debug) setCache(key, result);
  return result;
}
