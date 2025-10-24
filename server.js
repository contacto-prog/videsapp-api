// server.js
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import puppeteer from 'puppeteer';

import { sourceId as ahumadaId, fetchAhumada } from './scrapers/ahumada.js';
import { sourceId as cruzverdeId, fetchCruzVerde } from './scrapers/cruzverde.js';
import { sourceId as farmaId, fetchFarmaexpress } from './scrapers/farmaexpress.js';
import { sourceId as drsimiId, fetchDrsimi } from './scrapers/drsimi.js';
import { sourceId as salcoId, fetchSalcobrand } from './scrapers/salcobrand.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(compression());
app.use(morgan('tiny'));

const PORT = process.env.PORT || 10000;
const ENABLE_SCRAPER = (process.env.ENABLE_SCRAPER || 'true') === 'true';
const PER_SOURCE_TIMEOUT = Number(process.env.PER_SOURCE_TIMEOUT_MS || 25000);
const CONCURRENCY = Math.min(Math.max(Number(process.env.SCRAPER_CONCURRENCY || 2), 1), 4);

const SOURCES = [
  { id: ahumadaId, run: fetchAhumada },
  { id: cruzverdeId, run: fetchCruzVerde },
  { id: farmaId, run: fetchFarmaexpress },
  { id: drsimiId, run: fetchDrsimi },
  { id: salcoId, run: fetchSalcobrand },
];

/* ---------- Root OK (evita 502/404 en /) ---------- */
app.get('/', (_req, res) => {
  res.type('text/plain').send('VIDESAPP API – OK. Use /health or /prices?product=paracetamol');
});

/* ---------- Healthcheck ---------- */
app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    service: 'videsapp-prices',
    enableScraper: ENABLE_SCRAPER,
    node: process.version,
    time: new Date().toISOString(),
  });
});

/* ---------- Helpers ---------- */
function withTimeout(promiseFactory, ms) {
  const t = new Promise((_, rej) => setTimeout(() => rej(new Error('source_timeout')), ms));
  return Promise.race([promiseFactory(), t]);
}

function avg(nums) {
  const arr = nums.filter((n) => Number.isFinite(n));
  if (!arr.length) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

async function runWithConcurrency(items, limit, fn) {
  const out = Array(items.length);
  let i = 0;
  const workers = Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    });
  await Promise.all(workers);
  return out;
}

/* ---------- Endpoint principal ---------- */
app.get('/prices', async (req, res) => {
  try {
    if (!ENABLE_SCRAPER) {
      return res.status(503).json({ ok: false, error: 'scraper_disabled' });
    }
    const product = String(req.query.product || '').trim();
    if (!product) {
      return res.status(400).json({ ok: false, error: 'missing_param_product' });
    }

    const started = Date.now();
    const browser = await launchBrowser();

    try {
      const results = await runWithConcurrency(SOURCES, CONCURRENCY, async (src) => {
        const t0 = Date.now();
        let page;
        try {
          page = await browser.newPage();

          // Bloqueo de recursos pesados/trackers para acelerar
          try {
            await page.setRequestInterception(true);
            page.on('request', (reqq) => {
              const type = reqq.resourceType();
              if (type === 'image' || type === 'media' || type === 'font') return reqq.abort();
              const u = reqq.url();
              if (/googletagmanager|google-analytics|doubleclick|facebook|hotjar|optimizely|segment/i.test(u)) {
                return reqq.abort();
              }
              reqq.continue();
            });
          } catch {}

          const items = await withTimeout(() => src.run(page, product), PER_SOURCE_TIMEOUT);

          const mapped = (items || []).map((it) => ({
            title: it.title,
            price: it.price,
            url: it.url,
            source: it.source || src.id,
          }));
          const prices = mapped.map((x) => x.price).filter((n) => Number.isFinite(n));
          return {
            source: src.id,
            ok: true,
            count: mapped.length,
            avg: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
            tookMs: Date.now() - t0,
            items: mapped,
          };
        } catch (e) {
          return {
            source: src.id,
            ok: false,
            error: String(e && e.message ? e.message : e),
            count: 0,
            tookMs: Date.now() - t0,
            items: [],
          };
        } finally {
          try { if (page) await page.close(); } catch {}
        }
      });

      const allPrices = results.flatMap((r) => r.items.map((x) => x.price));
      const overall = avg(allPrices);

      // No-cache headers
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');

      res.json({
        ok: true,
        product,
        tookMs: Date.now() - started,
        concurrency: CONCURRENCY,
        perSourceTimeoutMs: PER_SOURCE_TIMEOUT,
        average: overall,
        sources: results,
      });
    } finally {
      try { await browser.close(); } catch {}
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

/* ---------- 404 JSON fallback ---------- */
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'not_found', path: req.path });
});

/* ---------- Start & graceful shutdown ---------- */
const server = app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});

async function shutdown() {
  console.log('Shutting down...');
  try { server.close(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
