// scrapers/index.js
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

// ------------------------------------------------------------------
// Paths util
// ------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------
const HEADFUL = process.env.HEADFUL === '1';
const DUMP    = process.env.DUMP === '1';

const DEFAULT_NAV_TIMEOUT = 45000;

const SOURCES = [
  { id: cv, fn: fetchCruzVerde,    timeoutMs: 30000 },
  { id: sb, fn: fetchSalcobrand,   timeoutMs: 25000 },
  { id: ah, fn: fetchAhumada,      timeoutMs: 30000 },
  { id: fe, fn: fetchFarmaexpress, timeoutMs: 30000 },
  { id: ds, fn: fetchDrSimi,       timeoutMs: 25000 },
];

// Caché en memoria (TTL en ms)
const CACHE  = new Map();
const TTL_MS = 1000 * 60 * 30; // 30 minutos

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
    promise.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); }
    );
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

async function preparePage(page) {
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8' });
  await page.emulateTimezone('America/Santiago');
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  );
  // Evasión simple de webdriver
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  page.setDefaultNavigationTimeout(DEFAULT_NAV_TIMEOUT);
  page.setDefaultTimeout(DEFAULT_NAV_TIMEOUT);
}

async function dumpPage(page, sourceId, step) {
  if (!DUMP) return;
  const dir = path.join(__dirname, '..', '.scrape-dumps', sourceId);
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(dir, `${ts}_${step}`);
  try { await page.screenshot({ path: `${base}.png`, fullPage: true }); } catch {}
  try { const html = await page.content(); fs.writeFileSync(`${base}.html`, html, 'utf8'); } catch {}
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
    headless: HEADFUL ? false : 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--lang=es-CL,es;q=0.9,en;q=0.8',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,900'
    ],
  });

  const page = await browser.newPage();
  await preparePage(page);

  const items = [];
  const sourcesTried = [];
  const errors = [];

  try {
    // Ejecuta por fuente con timeout + 1 reintento más corto si falla
    for (const s of SOURCES) {
      sourcesTried.push(s.id);

      // Limpia estado entre fuentes
      try { await page.goto('about:blank', { waitUntil: 'domcontentloaded' }); } catch {}
      await dumpPage(page, s.id, 'before-run');

      const runOnce = async (label, timeoutMs) => {
        // Cada scraper debe encargarse de navegar; nosotros dejamos la página lista
        const rows = await withTimeout(s.fn(page, key), timeoutMs, label);
        return Array.isArray(rows) ? rows : [];
      };

      try {
        const rows = await runOnce(s.id, s.timeoutMs);
        for (const r of rows) items.push(r);
        // Si no trajo nada, haz dump para inspección
        if (!rows.length) await dumpPage(page, s.id, 'empty-first');
      } catch (e1) {
        // Reintento con timeout más corto
        try {
          const retryMs = Math.max(8000, Math.floor(s.timeoutMs * 0.6));
          const rows2 = await runOnce(`${s.id}_retry`, retryMs);
          for (const r of rows2) items.push(r);
          if (!rows2.length) await dumpPage(page, s.id, 'empty-retry');
        } catch (e2) {
          errors.push({ source: s.id, error: String(e2?.message || e2) });
          await dumpPage(page, s.id, 'error');
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
    errors, // útil para debug
    note: 'Agregación multi-fuente; cada fuente tiene timeout y reintento. HTML puede cambiar.',
  };

  setCache(key, result);
  return result;
}
