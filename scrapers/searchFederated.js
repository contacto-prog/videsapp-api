// scrapers/searchFederated.js
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';

const TTL_MS = 1000 * 60 * 10; // 10 min cache
const CACHE = new Map();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36';
const priceRx = /\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/;
const toPrice = (s)=> s ? Number(s.replace(/\$/g,'').replace(/\./g,'').replace(',','.')) : undefined;

function setCache(k, v){ CACHE.set(k, {v, t: Date.now()}); }
function getCache(k){ const e = CACHE.get(k); if(!e) return null; if(Date.now()-e.t>TTL_MS){CACHE.delete(k); return null;} return e.v; }

async function getText(url){
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language':'es-CL,es;q=0.9' }});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}
function norm({source,url,name,price,availability}){
  return {
    source, url,
    name: (name||'').trim().slice(0,160),
    price: typeof price==='number' && Number.isFinite(price) ? price : undefined,
    availability: availability || 'unknown'
  };
}
function withTimeout(p, ms){ return new Promise((res,rej)=>{ const t=setTimeout(()=>rej(new Error(`timeout_${ms}ms`)),ms); p.then(x=>{clearTimeout(t);res(x)},e=>{clearTimeout(t);rej(e)}); }); }
async function withBrowser(run){
  const browser = await puppeteer.launch({
    headless:'new',
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
  });
  try { return await run(browser); } finally { await browser.close().catch(()=>{}); }
}

// ---------- TOP-1 por sitio (search -> primer producto) ----------

// Salcobrand (sin navegador)
async function top1Salcobrand(q){
  const url = `https://salcobrand.cl/search?q=${encodeURIComponent(q)}`;
  const html = await getText(url);
  const $ = cheerio.load(html);
  let best = null;
  $('a').each((_,a)=>{
    const href = $(a).attr('href')||'';
    if(!/\/products\//i.test(href)) return;
    const abs = new URL(href, url).toString();
    const card = $(a).closest('div').text();
    const name = ($(a).text()||card||'').trim();
    const priceTxt = (card.match(priceRx)||[])[0]||'';
    best = norm({ source:'salcobrand', url:abs, name, price: toPrice(priceTxt), availability: /Agotado|No disponible/i.test(card)?'out_of_stock':'unknown' });
    return false; // primer match
  });
  return best ? [best] : [];
}

// Dr. Simi (sin navegador)
async function top1DrSimi(q){
  const url = `https://www.drsimi.cl/catalogsearch/result/?q=${encodeURIComponent(q)}`;
  const html = await getText(url);
  const $ = cheerio.load(html);
  let best = null;
  $('a').each((_,a)=>{
    const href = $(a).attr('href')||'';
    if(!(/\/p($|[\/\?])|\/producto|\/product/i.test(href))) return;
    const abs = new URL(href, url).toString();
    const card = $(a).closest('li,div').text();
    const name = ($(a).text()||card||'').trim();
    const priceTxt = (card.match(priceRx)||[])[0]||'';
    best = norm({ source:'drsimi', url:abs, name, price: toPrice(priceTxt), availability: /Agotado|No disponible|Sin stock/i.test(card)?'out_of_stock':'unknown' });
    return false;
  });
  return best ? [best] : [];
}

// Farmex (Shopify sin navegador)
async function top1Farmex(q){
  const url = `https://farmex.cl/search?q=${encodeURIComponent(q)}`;
  const html = await getText(url);
  const $ = cheerio.load(html);
  let best = null;
  $('a').each((_,a)=>{
    const href = $(a).attr('href')||'';
    if(!/\/products\//i.test(href)) return;
    const abs = new URL(href, url).toString();
    const card = $(a).closest('div').text();
    const name = ($(a).text()||card||'').trim();
    const priceTxt = (card.match(priceRx)||[])[0]||'';
    best = norm({ source:'farmex', url:abs, name, price: toPrice(priceTxt), availability: /Agotado|Sin stock/i.test(card)?'out_of_stock':'unknown' });
    return false;
  });
  return best ? [best] : [];
}

// Ahumada (con navegador)
async function top1Ahumada(q){
  return await withBrowser(async (browser)=>{
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language':'es-CL,es;q=0.9' });
    const url = `https://www.farmaciasahumada.cl/search?q=${encodeURIComponent(q)}`;
    await page.goto(url, { waitUntil:'networkidle2', timeout:60000 });
    const row = await page.evaluate((priceReStr)=>{
      const priceRe = new RegExp(priceReStr);
      let best=null;
      const as = Array.from(document.querySelectorAll('a'));
      for(const a of as){
        const href=a.getAttribute('href')||'';
        if(!/\/product|\/products|\/medicamento|\/producto/i.test(href) || href.includes('#')) continue;
        const abs = new URL(href, location.href).toString();
        const card = a.closest('div')?.innerText || a.innerText || '';
        const name = a.textContent?.trim() || card.trim();
        const priceTxt = (card.match(priceRe)||[])[0]||'';
        const availability = /Agotado|No disponible|Sin stock/i.test(card)?'out_of_stock':'unknown';
        best = { url:abs, name, priceTxt, availability }; break;
      }
      return best;
    }, priceRx.source);
    return row ? [norm({ source:'ahumada', url:row.url, name:row.name, price: toPrice(row.priceTxt), availability: row.availability })] : [];
  });
}

// Cruz Verde (con navegador)
async function top1CruzVerde(q){
  return await withBrowser(async (browser)=>{
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language':'es-CL,es;q=0.9' });
    const url = `https://www.cruzverde.cl/search?q=${encodeURIComponent(q)}`;
    await page.goto(url, { waitUntil:'networkidle2', timeout:60000 });
    const row = await page.evaluate((priceReStr)=>{
      const priceRe = new RegExp(priceReStr);
      let best=null;
      const as = Array.from(document.querySelectorAll('a'));
      for(const a of as){
        const href=a.getAttribute('href')||'';
        if(!/\d+\.html$|\/product|\/products|\/producto/i.test(href) || href.includes('#')) continue;
        const abs = new URL(href, location.href).toString();
        const card = a.closest('div')?.innerText || a.innerText || '';
        const name = a.textContent?.trim() || card.trim();
        const priceTxt = (card.match(priceRe)||[])[0]||'';
        const availability = /Agotado|No disponible|Sin stock/i.test(card)?'out_of_stock':'unknown';
        best = { url:abs, name, priceTxt, availability }; break;
      }
      return best;
    }, priceRx.source);
    return row ? [norm({ source:'cruzverde', url:row.url, name:row.name, price: toPrice(row.priceTxt), availability: row.availability })] : [];
  });
}

// -------------------- API principal --------------------
export async function federatedSearchTop1(q){
  const key = (q||'').trim().toLowerCase();
  if(!key) throw new Error('q_required');

  const cached = getCache(key);
  if(cached) return cached;

  const tasks = [
    withTimeout(top1Salcobrand(key), 12000).catch(()=>[]),
    withTimeout(top1DrSimi(key),     12000).catch(()=>[]),
    withTimeout(top1Farmex(key),     12000).catch(()=>[]),
    withTimeout(top1Ahumada(key),    18000).catch(()=>[]),
    withTimeout(top1CruzVerde(key),  18000).catch(()=>[]),
  ];

  const settled = await Promise.allSettled(tasks);
  const items = settled.flatMap(s => s.status==='fulfilled' ? s.value : []);

  const result = { ok:true, q:key, count: items.length, items };
  setCache(key, result);
  return result;
}
