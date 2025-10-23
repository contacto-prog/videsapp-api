// scrapers/index.js
import puppeteer from 'puppeteer';
import { normalizeProduct } from './utils.js';
import { fetchCruzVerde, sourceId as cv } from './cruzverde.js';
import { fetchSalcobrand, sourceId as sb } from './salcobrand.js';
import { fetchAhumada, sourceId as ah } from './ahumada.js';
import { fetchFarmaexpress, sourceId as fe } from './farmaexpress.js';
import { fetchDrSimi, sourceId as ds } from './drsimi.js';

const SOURCES = [
  { id: cv, fn: fetchCruzVerde },
  { id: sb, fn: fetchSalcobrand },
  { id: ah, fn: fetchAhumada },
  { id: fe, fn: fetchFarmaexpress },
  { id: ds, fn: fetchDrSimi },
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

export async function scrapePrices(product) {
  const key = normalizeProduct(product);
  const cached = getCache(key);
  if (cached) return cached;

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
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });

  const items = [];
  const sourcesTried = [];

  try {
    for (const s of SOURCES) {
      sourcesTried.push(s.id);
      const rows = await s.fn(page, key);
      for (const r of rows) items.push(r);
    }
  } finally {
    await browser.close().catch(()=>{});
  }

  const prices = items.map(i => i.price).filter(n => typeof n === 'number');
  const averagePrice = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : null;

  const result = {
    product: key,
    averagePrice,
    count: items.length,
    items,
    sources: sourcesTried,
    note: 'Datos reales con navegador headless (Puppeteer); HTML puede cambiar.',
  };

  setCache(key, result);
  return result;
}
