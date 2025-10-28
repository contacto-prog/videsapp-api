import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import { normalizeProduct } from './utils.js';
import { fetchCruzVerde,  sourceId as cv } from './cruzverde.js';
import { fetchSalcobrand, sourceId as sb } from './salcobrand.js';
import { fetchAhumada,    sourceId as ah } from './ahumada.js';
import { fetchFarmaexpress, sourceId as fe } from './farmaexpress.js';
import { fetchDrSimi,     sourceId as ds } from './drsimi.js';

export const __INDEX_VERSION = 'v4.5-safe-retry';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const HEADFUL = process.env.HEADFUL === '1';
const DUMP    = process.env.DUMP === '1';
const DEBUG   = process.env.DEBUG === '1';

const DEFAULT_NAV_TIMEOUT = 45000;

const SOURCES = [
  { id: cv, fn: fetchCruzVerde,    timeoutMs: 30000 },
  { id: sb, fn: fetchSalcobrand,   timeoutMs: 25000 },
  { id: ah, fn: fetchAhumada,      timeoutMs: 30000 },
  { id: fe, fn: fetchFarmaexpress, timeoutMs: 30000 },
  { id: ds, fn: fetchDrSimi,       timeoutMs: 25000 },
];

const FALLBACK = {
  [cv]: { buildUrl: q => `https://www.cruzverde.cl/search?q=${encodeURIComponent(q)}`,
    selectors: ['[data-product-id]','.product-tile','.product-list__item','article','.product','.product-card','.grid-item','.product-item','.product-grid__item'],
    nameSel: ['.product-title','.product-card__title','h3','h2','a[title]','a'],
    priceSel: ['.price','.product-price','.price__regular','[class*="price"]','[data-price]']
  },
  [sb]: { buildUrl: q => `https://salcobrand.cl/search?type=product&q=${encodeURIComponent(q)}`,
    selectors: ['.product-grid .grid__item','.product-item','article','[data-product-id]','.card-wrapper','.grid__item'],
    nameSel: ['.product-item__title','.card__heading','a[title]','h3','h2','.product-title','.title','a'],
    priceSel: ['.price','.price-item','.price__regular','.product-price','[class*="price"]','[data-price]']
  },
  [ah]: { buildUrl: q => `https://www.farmaciasahumada.cl/search?q=${encodeURIComponent(q)}`,
    selectors: ['.product-grid-item','.product-item','[data-product-id]','article','.product','.product-card'],
    nameSel: ['h3','h2','.product-title','.title','a[title]','a'],
    priceSel: ['.price','.product-price','[class*="price"]','[data-price]']
  },
  [fe]: { buildUrl: q => `https://farmex.cl/search?q=${encodeURIComponent(q)}`,
    selectors: ['.product-card','.product','article','.grid-item','.product-item'],
    nameSel: ['h3','h2','.product-title','.title','a[title]','a'],
    priceSel: ['.price','.product-price','[class*="price"]','[data-price]']
  },
  [ds]: { buildUrl: q => `https://www.drsimi.cl/catalogsearch/result/?q=${encodeURIComponent(q)}`,
    selectors: ['.product-item','.item','[data-product-id]','article','.product','.product-card'],
    nameSel: ['h3','h2','.product-title','.title','a[title]','a'],
    priceSel: ['.price','.product-price','[class*="price"]','[data-price]']
  },
};

const CACHE  = new Map();
const TTL_MS = 1000 * 60 * 30;

function setCache(key, data) { CACHE.set(key, { data, t: Date.now() }); }
function getCache(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > TTL_MS) { CACHE.delete(key); return null; }
  return hit.data;
}

function log(...args) { if (DEBUG) console.log('[scrape]', ...args); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function safeEval(page, fn, arg, retries=2) {
  for (let i=0;i<=retries;i++){
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      const msg = String(e?.message||e);
      if (i === retries || !/Execution context was destroyed|Cannot find context|Most likely because of a navigation/i.test(msg)) {
        throw e;
      }
      await page.waitForSelector('body', {timeout: 5000}).catch(()=>{});
      await sleep(600);
    }
  }
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label || 'operation'}_timeout_${ms}ms`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = [
      (it.source || '').toLowerCase(),
      (it.url || '').split('?')[0],
      (it.name || '').toLowerCase().trim(),
      (it.sku || '').toLowerCase()
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function robustAverage(nums) {
  if (!nums.length) return null;
  const arr = [...nums].sort((a,b)=>a-b);
  const mid = arr.length >> 1;
  const median = arr.length % 2 ? arr[mid] : Math.round((arr[mid-1] + arr[mid]) / 2);
  const filtered = arr.filter(n => n > 0 && n < median * 5);
  if (!filtered.length) return Math.round(median);
  const avg = filtered.reduce((a,b)=>a+b,0) / filtered.length;
  return Math.round(avg);
}

function normStr(s){ return (s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/\s+/g,' ').trim(); }
function isRelevantName(name, qTokens){
  const n = normStr(name);
  return qTokens.some(t => n.includes(t));
}
function isPlausiblePriceCLP(p){ return Number.isFinite(p) && p >= 200 && p <= 100000; }
function looksLikeProductPath(uStr){
  try{
    const u = new URL(uStr);
    const p = u.pathname.toLowerCase();
    if (!p || p === '/' ) return false;
    const bad = ['terminos','condiciones','bases-legales','politica','proteccion','uso-racional','dermocosmetica','marcas','wa.me','leychile','ispch','arquivos','pages/patologias','pages/medicamentos-remedios','blog','fe-de-erratas','textos-legales','category','collections','pages'];
    if (bad.some(b => p.includes(b)) || u.host.includes('bcn.cl') || u.host.includes('wa.me')) return false;
    const good = ['products','producto','productos','catalog','item','sku','/p/','/prod/','/sku/','/paracetamol'];
    return good.some(h => p.includes(h)) || /\d/.test(p) || p.endsWith('.html');
  }catch{ return false; }
}
function sameHost(uStr, host){ try{ return new URL(uStr).host === host; }catch{ return false; } }

async function preparePage(page) {
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8' });
  await page.emulateTimezone('America/Santiago');
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  page.setDefaultNavigationTimeout(DEFAULT_NAV_TIMEOUT);
  page.setDefaultTimeout(DEFAULT_NAV_TIMEOUT);
}

async function dumpPage(page, sourceId, step) {
  if (!DUMP) return;
  try {
    if (page.isClosed()) return;
    const mf = page.mainFrame();
    if (!mf || mf.isDetached?.()) return;
  } catch { return; }
  try {
    const dir = path.join(__dirname, '..', '.scrape-dumps', sourceId);
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(dir, `${ts}_${step}`);
    try { await page.screenshot({ path: `${base}.png`, fullPage: true }); } catch {}
    try { const html = await page.content(); fs.writeFileSync(`${base}.html`, html, 'utf8'); } catch {}
  } catch {}
}

async function callScraperFlexible(s, page, q) {
  try {
    const maybe = await s.fn(page, q);
    if (Array.isArray(maybe)) return maybe;
    if (maybe && typeof maybe.then === 'function') { const r = await maybe; if (Array.isArray(r)) return r; }
  } catch (e) { log(s.id, 'firma(page,q) error:', e?.message || e); }
  try {
    const maybe = await s.fn(q, { puppeteer });
    if (Array.isArray(maybe)) return maybe;
    if (maybe && typeof maybe.then === 'function') { const r = await maybe; if (Array.isArray(r)) return r; }
  } catch (e) { log(s.id, 'firma(q,{puppeteer}) error:', e?.message || e); throw e; }
  return [];
}

function buildGenericExtractor(sourceId, qTokens, host) {
  const cfg = FALLBACK[sourceId]; if (!cfg) return null;
  const { selectors, nameSel, priceSel } = cfg;

  return async function genericExtract(page) {
    await page.waitForSelector('body', { timeout: 20000 }).catch(()=>{});
    await sleep(500);

    const fromJsonLd = await safeEval(page, (sourceId) => {
      const out = [];
      const norm = (s) => (s || '').replace(/\s+/g,' ').trim();
      const toNum = (v) => { if (v == null) return null; const n = parseInt(String(v).replace(/[^\d]/g,''),10); return Number.isFinite(n) && n > 0 ? n : null; };
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const s of scripts) {
        let json; try { json = JSON.parse(s.textContent || 'null'); } catch { json = null; }
        if (!json) continue;
        const pushProduct = (p) => {
          const name = norm(p?.name);
          const url  = p?.url || p?.['@id'] || '';
          const price = toNum(p?.offers?.price || p?.offers?.lowPrice || p?.offers?.highPrice);
          if (name && url && price) out.push({ source: sourceId, name, price, url });
        };
        const pushFromItemList = (j) => {
          if (j?.['@type'] === 'ItemList' && Array.isArray(j.itemListElement)) {
            for (const it of j.itemListElement) {
              const item = it?.item || it;
              if (item?.['@type'] === 'Product') pushProduct(item);
            }
          }
        };
        if (Array.isArray(json)) {
          for (const j of json) { if (j?.['@type'] === 'Product') pushProduct(j); pushFromItemList(j); }
        } else if (json && typeof json === 'object') {
          if (json?.['@type'] === 'Product') pushProduct(json);
          pushFromItemList(json);
          const graph = Array.isArray(json['@graph']) ? json['@graph'] : [];
          for (const g of graph) { if (g?.['@type'] === 'Product') pushProduct(g); pushFromItemList(g); }
        }
      }
      return out.slice(0, 40);
    }, sourceId).catch(()=>[]);

    let items = fromJsonLd || [];

    if (!items.length) {
      items = await safeEval(page, ({ selectors, nameSel, priceSel, sourceId }) => {
        const norm = (s) => (s || '').replace(/\s+/g,' ').trim();
        const getPrice = (txt) => { if (!txt) return null; const m = txt.replace(/\./g,'').match(/(\$?\s*\d[\d\s]*)/); if (!m) return null; const n = parseInt(m[1].replace(/[^\d]/g,''),10); return Number.isFinite(n) && n>0 ? n : null; };
        const selList = selectors.join(',');
        const nodes = Array.from(document.querySelectorAll(selList));
        const take = [];
        for (const el of nodes) {
          const nameEl = el.querySelector(nameSel.join(',')) || el.closest('article, .product, .product-item, .product-card, .grid-item')?.querySelector(nameSel.join(','));
          const priceEl = el.querySelector(priceSel.join(','));
          const linkEl  = el.querySelector('a[href]');
          const name  = norm(nameEl?.textContent || '');
          const price = getPrice(priceEl?.textContent || '');
          const url   = linkEl?.href || '';
          if (name && url && price) { take.push({ source: sourceId, name, price, url }); }
          if (take.length >= 40) break;
        }
        return take;
      }, { selectors, nameSel, priceSel, sourceId }).catch(()=>[]);
    }

    if (!items.length) {
      items = await safeEval(page, (sourceId) => {
        const out = [];
        const norm = (s) => (s || '').replace(/\s+/g,' ').trim();
        const getPrice = (txt) => { if (!txt) return null; const m = txt.replace(/\./g,'').match(/(\$?\s*\d[\d\s]*)/); if (!m) return null; const n = parseInt(m[1].replace(/[^\d]/g,''),10); return Number.isFinite(n) && n>0 ? n : null; };
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        for (const a of anchors) {
          const name = norm(a.textContent || '');
          const url = a.href || '';
          if (!name || name.length < 5) continue;
          if (!url || !/^https?:/.test(url)) continue;
          const root = a.closest('article, .product, .product-item, .product-card, .grid-item, li, div');
          let price = null;
          if (root) {
            const candidates = Array.from(root.querySelectorAll('*')).slice(0, 80);
            for (const el of candidates) { if (price) break; price = getPrice(el.textContent || ''); }
          }
          if (!price) {
            const sibs = [];
            let p = a.parentElement;
            for (let i = 0; i < 4 && p; i++) { sibs.push(...p.children); p = p.parentElement; }
            for (const el of sibs) { price = getPrice(el.textContent || ''); if (price) break; }
          }
          if (price) {
            out.push({ source: sourceId, name, price, url });
            if (out.length >= 60) break;
          }
        }
        const seen = new Set(); const unique = [];
        for (const it of out) {
          const k = (it.url||'').split('?')[0] + '|' + norm(it.name||'').toLowerCase();
          if (seen.has(k)) continue; seen.add(k); unique.push(it);
        }
        return unique;
      }, sourceId).catch(()=>[]);
    }

    items = items.filter(it => {
      if (!isPlausiblePriceCLP(it.price)) return false;
      if (!sameHost(it.url, host)) return false;
      if (!looksLikeProductPath(it.url)) return false;
      if (!isRelevantName(it.name, qTokens) && !it.url.toLowerCase().includes('paracetamol')) return false;
      return true;
    });

    return items;
  };
}

async function runFallbackForSource(browser, sourceId, q) {
  const cfg = FALLBACK[sourceId]; if (!cfg) return [];
  const url = cfg.buildUrl(q);
  const host = new URL(url).host;
  const qTokens = [normStr(q), 'paracetamol', 'acetaminof', 'acetaminofen', 'acetaminophen'].map(normStr);

  const page = await browser.newPage();
  try {
    await preparePage(page);
    log(sourceId, 'fallback →', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_NAV_TIMEOUT }).catch(()=>{});
    await safeEval(page, () => document.readyState, null, 1).catch(()=>{});
    await page.waitForSelector('body', { timeout: 20000 }).catch(()=>{});
    await sleep(900);
    await dumpPage(page, sourceId, 'fallback-dom');
    const extractor = buildGenericExtractor(sourceId, qTokens, host); if (!extractor) return [];
    const rows = await extractor(page);
    log(sourceId, 'fallback_items:', Array.isArray(rows) ? rows.length : 0);
    if (!rows.length) await dumpPage(page, sourceId, 'fallback-empty');
    return rows;
  } finally {
    try { await dumpPage(page, sourceId, 'fallback-final'); } catch {}
    await page.close().catch(()=>{});
  }
}

export async function scrapePrices(product) {
  const key = normalizeProduct(product);
  const cached = getCache(key); if (cached) return cached;

  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--lang=es-CL,es;q=0.9,en;q=0.8','--disable-blink-features=AutomationControlled','--window-size=1280,900'],
  });

  const items = [];
  const sourcesTried = [];
  const errors = [];

  try {
    for (const s of SOURCES) {
      sourcesTried.push(s.id);
      log('>>>> Fuente:', s.id);
      const page = await browser.newPage();
      try {
        await preparePage(page);
        await dumpPage(page, s.id, 'before-run');
        let rows = [];
        let usedFallback = false;
        try {
          rows = await withTimeout(callScraperFlexible(s, page, key), s.timeoutMs, s.id);
          log(s.id, 'scraper_items:', Array.isArray(rows) ? rows.length : 0);
        } catch (e1) {
          log(s.id, 'scraper_error:', e1?.message || e1);
          try {
            const retryMs = Math.max(8000, Math.floor(s.timeoutMs * 0.6));
            rows = await withTimeout(callScraperFlexible(s, page, key), retryMs, s.id + '_retry');
            log(s.id, 'retry_items:', Array.isArray(rows) ? rows.length : 0);
          } catch (e2) {
            errors.push({ source: s.id, error: `scraper_error: ${String(e2?.message || e2)}` });
            await dumpPage(page, s.id, 'error');
          }
        }
        if (!rows || !rows.length) {
          usedFallback = true;
          try {
            const fbRows = await runFallbackForSource(browser, s.id, key);
            rows = fbRows;
            if (!rows.length) { errors.push({ source: s.id, error: 'fallback_empty' }); }
          } catch (e3) {
            errors.push({ source: s.id, error: `fallback_error: ${String(e3?.message || e3)}` });
            await dumpPage(page, s.id, 'fallback-error');
          }
        }
        if (Array.isArray(rows) && rows.length) {
          for (const r of rows) items.push(r);
        } else {
          await dumpPage(page, s.id, usedFallback ? 'empty-after-fallback' : 'empty-after-scraper');
        }
      } finally {
        await page.close().catch(()=>{});
        await sleep(300);
      }
    }
  } finally {
    await browser.close().catch(()=>{});
  }

  const unique = dedupeItems(items);
  const prices = unique.map(i => i?.price).filter(n => typeof n === 'number' && Number.isFinite(n) && n > 0);
  const averagePrice = robustAverage(prices);

  const result = {
    _version: __INDEX_VERSION,
    product: key,
    averagePrice,
    count: unique.length,
    items: unique,
    sources: sourcesTried,
    errors,
    note: 'INDEX v4.5 safe retry',
  };

  setCache(key, result);
  return result;
}
