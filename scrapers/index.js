// scrapers/index.js
import puppeteer from 'puppeteer';
import { normalizeProduct } from './utils.js';
import { fetchCruzVerde, sourceId as cv } from './cruzverde.js';
import { fetchSalcobrand, sourceId as sb } from './salcobrand.js';
import { fetchAhumada, sourceId as ah } from './ahumada.js';
import { fetchFarmaexpress, sourceId as fe } from './farmaexpress.js';
import { fetchDrSimi, sourceId as ds } from './drsimi.js';

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------
const SOURCES = [
  { id: cv, fn: fetchCruzVerde,  timeoutMs: 25000 },
  { id: sb, fn: fetchSalcobrand, timeoutMs: 15000 },
  { id: ah, fn: fetchAhumada,    timeoutMs: 20000 },
  { id: fe, fn: fetchFarmaexpress, timeoutMs: 20000 },
  { id: ds, fn: fetchDrSimi,     timeoutMs: 15000 },
];

// Caché en memoria (TTL en ms)
const CACHE = new Map();
const TTL_MS = 1000 * 60 * 30; // 30 min

function setCache(key, data) { CACHE.set(key, { data, t: Date.now() }); }
function getCache(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > TTL_MS) { CACHE.delete(key); return null; }
  return hit.data;
}

// ------------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------------
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
  // descarta outliers grotescos (fuera de 5x del mediano)
  const arr = [...nums].sort((a,b)=>a-b);
  const mid = arr.length >> 1;
  const median = arr.length % 2 ? arr[mid] : Math.round((arr[mid-1]+arr[mid])/2);
  const filtered = arr.filter(n => n > 0 && n < median * 5);
  if (!filtered.length) return Math.round(median);
  const avg = filtered.reduce((a,b)=>a+b,0)/filtered.length;
  return Math.round(avg);
}

// ------------------------------------------------------------------
// Scraper principal
// ------------------------------------------------------------------
export async function scrapePrices(product) {
  const key = normalizeProduct(product);
  const cached = getCache(key);
  if (cached) return cached;

  // Lanzamos un solo browser compartido para todas las fuentes
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });
  page.setDefaultNavigationTimeout(25000);
  page.setDefaultTimeout(25000);

  const items = [];
  const sourcesTried = [];
  const errors = [];

  try {
    // Ejecuta por fuente con timeout + 1 reintento rápido si falla
    for (const s of SOURCES) {
      sourcesTried.push(s.id);
      try {
        const run = () => s.fn(page, key);
        const rows = await withTimeout(run(), s.timeoutMs, s.id);
        if (Array.isArray(rows)) {
          for (const r of rows) items.push(r);
        }
      } catch (e1) {
        // Reintento una vez con un timeout más corto
        try {
          const run2 = () => s.fn(page, key);
          const rows2 = await withTimeout(run2(), Math.max(8000, Math.floor(s.timeoutMs * 0.6)), s.id + '_retry');
          if (Array.isArray(rows2)) {
            for (const r of rows2) items.push(r);
          }
        } catch (e2) {
          errors.push({ source: s.id, error: String(e2?.message || e2) });
        }
      }
    }
  } finally {
    await browser.close().catch(()=>{});
  }

  const unique = dedupeItems(items);
  const prices = unique
    .map(i => i?.price)
    .filter(n => typeof n === 'number' && Number.isFinite(n) && n > 0);

  const averagePrice = robustAverage(prices);

  const result = {
    product: key,
    averagePrice,
    count: unique.length,
    items: unique,
    sources: sourcesTried,
    errors, // útil para debug en /prices y en logs
    note: 'Agregación multi-fuente; cada fuente tiene timeout y reintento. HTML puede cambiar.',
  };

  setCache(key, result);
  return result;
}
