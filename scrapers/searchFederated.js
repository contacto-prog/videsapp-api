// scrapers/searchFederated.js – buscador federado top-1 por farmacia (mejorado)
// Entra a la PÁGINA DE PRODUCTO para extraer título y precio reales.
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';

const TTL_MS = 1000 * 60 * 10; // 10 minutos
const CACHE = new Map();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36';

const priceRx = /\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/;
const toPrice = (s)=> s ? Number(s.replace(/\$/g,'').replace(/\./g,'').replace(',','.')) : undefined;
const looksLikeCategory = (s)=> /medicamentos|productos|categor[ií]a|resultados/i.test(s||'');

// Cache helpers
function setCache(k, v){ CACHE.set(k, {v, t: Date.now()}); }
function getCache(k){ const e = CACHE.get(k); if(!e) return null; if(Date.now()-e.t>TTL_MS){CACHE.delete(k); return null;} return e.v; }
function withTimeout(p, ms){ return new Promise((res,rej)=>{ const t=setTimeout(()=>rej(new Error(`timeout_${ms}ms`)),ms); p.then(x=>{clearTimeout(t);res(x)},e=>{clearTimeout(t);rej(e)}); }); }

// Networking helpers (sin navegador)
async function getText(url){
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language':'es-CL,es;q=0.9' }});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

// Normalización
function norm({source,url,name,price,availability}){
  return {
    source,
    url,
    name: (name||'').replace(/\s+/g,' ').trim().slice(0,160),
    price: typeof price==='number' && Number.isFinite(price) ? price : undefined,
    availability: availability || 'unknown'
  };
}

// Puppeteer sandbox
async function withBrowser(run){
  const browser = await puppeteer.launch({
    headless:'new',
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
  });
  try { return await run(browser); }
  finally { await browser.close().catch(()=>{}); }
}

// ---------- util: puntaje por coincidencia con la query ----------
function scoreByQuery(name, q) {
  const nq = q.toLowerCase();
  const nn = (name||'').toLowerCase();
  if (!nn) return 0;
  let score = 0;
  if (nn.includes(nq)) score += 3;
  // tokens básicos (paracetamol, 500, mg, 16, comprimidos)
  const toks = nq.split(/\s+/).filter(Boolean);
  for (const t of toks) if (nn.includes(t)) score += 1;
  return score;
}

// ---------- Visitar PÁGINA DE PRODUCTO y extraer título/precio ----------
async function extractFromProductPage(url){
  const html = await getText(url);
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim() ||
                $('[itemprop="name"]').first().text().trim() ||
                $('meta[property="og:title"]').attr('content') ||
                $('title').text().trim();
  const blob = $('body').text();
  const priceTxt =
    $('[class*="price"], .price, .product__price, [itemprop="price"]').first().text() ||
    blob.match(priceRx)?.[0] || '';
  const availability =
    /Agregar al carro|Añadir al carrito|Disponible/i.test(blob) ? 'in_stock' :
    (/Agotado|No disponible|Sin stock/i.test(blob) ? 'out_of_stock' : 'unknown');
  return { title, price: toPrice(priceTxt), availability };
}

// ---------- Salcobrand (sin navegador) ----------
async function top1Salcobrand(q){
  const searchUrl = `https://salcobrand.cl/search?q=${encodeURIComponent(q)}`;
  const html = await getText(searchUrl);
  const $ = cheerio.load(html);

  // toma los primeros enlaces a /products/*
  const candidates = [];
  $('a').each((_,a)=>{
    const href = $(a).attr('href')||'';
    if (!/\/products\//i.test(href) || href.includes('#')) return;
    const abs = new URL(href, searchUrl).toString();
    const name = ($(a).text() || $(a).closest('div').text() || '').trim();
    if (looksLikeCategory(name)) return;
    candidates.push({ url: abs, name });
  });
  // si no hay, nada
  if (!candidates.length) return [];

  // visita hasta 3 candidatos, elige el que más matchee la query
  const top = candidates.slice(0,3);
  const scored = [];
  for (const c of top) {
    try {
      const d = await extractFromProductPage(c.url);
      scored.push({ ...c, name: d.title || c.name, price: d.price, availability: d.availability,
        score: scoreByQuery(d.title || c.name, q) });
    } catch {}
  }
  if (!scored.length) return [];

  scored.sort((a,b)=> b.score - a.score);
  const best = scored[0];
  return [ norm({ source:'salcobrand', url:best.url, name:best.name, price:best.price, availability:best.availability }) ];
}

// ---------- Dr. Simi (sin navegador) ----------
async function top1DrSimi(q){
  const searchUrl = `https://www.drsimi.cl/catalogsearch/result/?q=${encodeURIComponent(q)}`;
  const html = await getText(searchUrl);
  const $ = cheerio.load(html);

  const candidates = [];
  $('a').each((_,a)=>{
    const href = $(a).attr('href')||'';
    if (!(/\/p($|[\/\?])|\/producto|\/product/i.test(href)) || href.includes('#')) return;
    const abs = new URL(href, searchUrl).toString();
    const name = ($(a).text() || $(a).closest('li,div').text() || '').trim();
    if (looksLikeCategory(name)) return;
    candidates.push({ url: abs, name });
  });
  if (!candidates.length) return [];

  const top = candidates.slice(0,3);
  const scored = [];
  for (const c of top) {
    try {
      const d = await extractFromProductPage(c.url);
      scored.push({ ...c, name: d.title || c.name, price: d.price, availability: d.availability,
        score: scoreByQuery(d.title || c.name, q) });
    } catch {}
  }
  if (!scored.length) return [];
  scored.sort((a,b)=> b.score - a.score);
  const best = scored[0];
  return [ norm({ source:'drsimi', url:best.url, name:best.name, price:best.price, availability:best.availability }) ];
}

// ---------- Farmex (Shopify, sin navegador) ----------
async function top1Farmex(q){
  const searchUrl = `https://farmex.cl/search?q=${encodeURIComponent(q)}`;
  const html = await getText(searchUrl);
  const $ = cheerio.load(html);

  const candidates = [];
  $('a').each((_,a)=>{
    const href = $(a).attr('href')||'';
    if (!/\/products\//i.test(href) || href.includes('#')) return;
    const abs = new URL(href, searchUrl).toString();
    const name = ($(a).text() || $(a).closest('div').text() || '').trim();
    if (looksLikeCategory(name)) return;
    candidates.push({ url: abs, name });
  });
  if (!candidates.length) return [];

  // visita hasta 5, elige el que mejor coincide (evitamos "KYLEENA" para "paracetamol")
  const top = candidates.slice(0,5);
  const scored = [];
  for (const c of top) {
    try {
      const d = await extractFromProductPage(c.url);
      scored.push({ ...c, name: d.title || c.name, price: d.price, availability: d.availability,
        score: scoreByQuery(d.title || c.name, q) });
    } catch {}
  }
  if (!scored.length) return [];
  scored.sort((a,b)=> b.score - a.score);
  const best = scored[0];
  return [ norm({ source:'farmex', url:best.url, name:best.name, price:best.price, availability:best.availability }) ];
}

// ---------- Ahumada (con navegador) ----------
async function top1Ahumada(q){
  return await withBrowser(async (browser)=>{
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language':'es-CL,es;q=0.9' });

    const searchUrl = `https://www.farmaciasahumada.cl/search?q=${encodeURIComponent(q)}`;
    await page.goto(searchUrl, { waitUntil:'networkidle2', timeout:60000 });

    // toma primer enlace de producto
    const productUrl = await page.evaluate(()=>{
      for (const a of Array.from(document.querySelectorAll('a'))) {
        const href = a.getAttribute('href')||'';
        if (/\/product|\/products|\/medicamento|\/producto/i.test(href) && !href.includes('#')) {
          try { return new URL(href, location.href).toString(); } catch {}
        }
      }
      return null;
    });
    if (!productUrl) return [];

    // entra a la página del producto y extrae
    await page.goto(productUrl, { waitUntil:'networkidle2', timeout:60000 });
    const row = await page.evaluate((priceReStr)=>{
      const priceRe = new RegExp(priceReStr);
      const pick = (sel)=> document.querySelector(sel)?.textContent?.trim() || null;
      const title = pick('h1') || pick('[itemprop="name"]') || document.title;
      const priceTxt =
        pick('[class*="price"]') || pick('.price') || document.body.innerText.match(priceRe)?.[0] || '';
      const availability = /Agregar al carro|Añadir al carrito|Disponible/i.test(document.body.innerText)
        ? 'in_stock'
        : (/Agotado|No disponible|Sin stock/i.test(document.body.innerText) ? 'out_of_stock' : 'unknown');
      return { title, priceTxt, availability };
    }, priceRx.source);

    return [ norm({ source:'ahumada', url:productUrl, name:row.title, price: toPrice(row.priceTxt), availability: row.availability }) ];
  });
}

// ---------- Cruz Verde (con navegador) ----------
async function top1CruzVerde(q){
  return await withBrowser(async (browser)=>{
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language':'es-CL,es;q=0.9' });

    const searchUrl = `https://www.cruzverde.cl/search?q=${encodeURIComponent(q)}`;
    await page.goto(searchUrl, { waitUntil:'networkidle2', timeout:60000 });

    const productUrl = await page.evaluate(()=>{
      for (const a of Array.from(document.querySelectorAll('a'))) {
        const href = a.getAttribute('href')||'';
        if ((/\d+\.html$/i.test(href) || /\/product|\/products|\/producto/i.test(href)) && !href.includes('#')) {
          try { return new URL(href, location.href).toString(); } catch {}
        }
      }
      return null;
    });
    if (!productUrl) return [];

    await page.goto(productUrl, { waitUntil:'networkidle2', timeout:60000 });
    const row = await page.evaluate((priceReStr)=>{
      const priceRe = new RegExp(priceReStr);
      const pick = (sel)=> document.querySelector(sel)?.textContent?.trim() || null;
      const title = pick('h1') || pick('[itemprop="name"]') || document.title;
      const priceTxt =
        pick('[class*="price"]') || pick('.price') || document.body.innerText.match(priceRe)?.[0] || '';
      const availability = /Agregar al carro|Añadir al carrito|Disponible/i.test(document.body.innerText)
        ? 'in_stock'
        : (/Agotado|No disponible|Sin stock/i.test(document.body.innerText) ? 'out_of_stock' : 'unknown');
      return { title, priceTxt, availability };
    }, priceRx.source);

    return [ norm({ source:'cruzverde', url:productUrl, name:row.title, price: toPrice(row.priceTxt), availability: row.availability }) ];
  });
}

// ---------- Orquestador ----------
export async function federatedSearchTop1(q){
  const key = (q||'').trim().toLowerCase();
  if(!key) throw new Error('q_required');

  const cached = getCache(key);
  if(cached) return cached;

  const tasks = [
    withTimeout(top1Salcobrand(key), 15000).catch(()=>[]),
    withTimeout(top1DrSimi(key),     15000).catch(()=>[]),
    withTimeout(top1Farmex(key),     15000).catch(()=>[]),
    withTimeout(top1Ahumada(key),    20000).catch(()=>[]),
    withTimeout(top1CruzVerde(key),  20000).catch(()=>[]),
  ];

  const settled = await Promise.allSettled(tasks);
  const items = settled.flatMap(s => s.status==='fulfilled' ? s.value : []);

  const result = { ok:true, q:key, count: items.length, items };
  setCache(key, result);
  return result;
}
