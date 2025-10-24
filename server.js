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
const ENV_TIMEOUT = Number(process.env.PER_SOURCE_TIMEOUT_MS || 25000);
const ENV_CONCURRENCY = Math.min(Math.max(Number(process.env.SCRAPER_CONCURRENCY || 2), 1), 4);

// ---- Root & Health
app.get('/', (_req, res) => {
  res.type('text/plain').send('VIDESAPP API – OK. Use /health o /prices?product=paracetamol');
});
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'videsapp-prices', enableScraper: ENABLE_SCRAPER, node: process.version, time: new Date().toISOString() });
});

// ---- Helpers
function withTimeout(promiseFactory, ms) {
  const t = new Promise((_, rej) => setTimeout(() => rej(new Error('source_timeout')), ms));
  return Promise.race([promiseFactory(), t]);
}
function avg(nums) {
  const arr = nums.filter(Number.isFinite);
  if (!arr.length) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}
async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'], // Render
  });
}
async function runWithConcurrency(items, limit, fn) {
  const out = Array(items.length);
  let i = 0;
  const workers = Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---- Sources registry
const ALL_SOURCES = [
  { id: ahumadaId, run: fetchAhumada },
  { id: cruzverdeId, run: fetchCruzVerde },
  { id: farmaId, run: fetchFarmaexpress },
  { id: drsimiId, run: fetchDrsimi },
  { id: salcoId, run: fetchSalcobrand },
];

// ---- /prices
app.get('/prices', async (req, res) => {
  // Evita que el proxy de Render cierre el socket por inactividad
  res.setTimeout(120000);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  try {
    if (!ENABLE_SCRAPER) {
      return res.status(503).json({ ok: false, error: 'scraper_disabled' });
    }

    const product = String(req.query.product || '').trim();
    if (!product) return res.status(400).json({ ok: false, error: 'missing_param_product' });

    // --- NUEVO: filtros desde query ---
    const only = (req.query.only || '').toString().split(',').map(s => s.trim()).filter(Boolean);
    const include = (req.query.include || '').toString().split(',').map(s => s.trim()).filter(Boolean);
    const conc = Math.min(Math.max(Number(req.query.conc || ENV_CONCURRENCY), 1), 4);
    const perSourceTimeout = Math.max(5000, Number(req.query.timeout || ENV_TIMEOUT)); // mínimo 5s

    // Selección de fuentes:
    let SOURCES = ALL_SOURCES;
    const byId = (id) => SOURCES.find(s => s.id === id);
    if (only.length) {
      SOURCES = only.map(id => byId(id)).filter(Boolean);
      if (!SOURCES.length) return res.status(400).json({ ok: false, error: 'invalid_only_filter', only });
    } else if (include.length) {
      const set = new Set(include);
      SOURCES = ALL_SOURCES.filter(s => set.has(s.id));
      if (!SOURCES.length) return res.status(400).json({ ok: false, error: 'invalid_include_filter', include });
    }

    const started = Date.now();
    console.log(`[PRICES] start product="${product}" conc=${conc} timeout=${perSourceTimeout}ms sources=[${SOURCES.map(s=>s.id).join(',')}]`);

    const browser = await launchBrowser();

    try {
      const results = await runWithConcurrency(SOURCES, conc, async (src) => {
        const t0 = Date.now();
        let page;
        try {
          page = await browser.newPage();

          // Bloquear recursos pesados (ahorra RAM y tiempo)
          try {
            await page.setRequestInterception(true);
            page.on('request', (reqq) => {
              const type = reqq.resourceType();
              if (type === 'image' || type === 'media' || type === 'font') return reqq.abort();
              const u = reqq.url();
              if (/googletagmanager|google-analytics|doubleclick|facebook|hotjar|optimizely|segment/i.test(u)) return reqq.abort();
              reqq.continue();
            });
          } catch {}

          const items = await withTimeout(() => src.run(page, product), perSourceTimeout);
          const mapped = (items || []).map((it) => ({
            title: it.title, price: it.price, url: it.url, source: it.source || src.id,
          }));
          const prices = mapped.map(x => x.price).filter(Number.isFinite);

          const okPayload = {
            source: src.id,
            ok: true,
            count: mapped.length,
            avg: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
            tookMs: Date.now() - t0,
            items: mapped,
          };
          console.log(`[PRICES] ${src.id} ok count=${okPayload.count} took=${okPayload.tookMs}ms`);
          return okPayload;
        } catch (e) {
          const errPayload = {
            source: src.id,
            ok: false,
            error: String(e && e.message ? e.message : e),
            count: 0,
            tookMs: Date.now() - t0,
            items: [],
          };
          console.error(`[PRICES] ${src.id} FAIL after ${errPayload.tookMs}ms ->`, errPayload.error);
          return errPayload;
        } finally {
          try { if (page) await page.close(); } catch {}
        }
      });

      const allPrices = results.flatMap(r => r.items.map(x => x.price));
      const payload = {
        ok: true,
        product,
        tookMs: Date.now() - started,
        concurrency: conc,
        perSourceTimeoutMs: perSourceTimeout,
        average: avg(allPrices),
        sources: results,
      };
      console.log(`[PRICES] done took=${payload.tookMs}ms avg=${payload.average}`);
      return res.json(payload);
    } finally {
      try { await browser.close(); } catch {}
    }
  } catch (err) {
    console.error('[PRICES] top-level error:', err);

    // ---- NUEVO: modo seguro, 1 sola fuente (farmaexpress) para no devolver 502
    try {
      const browser = await launchBrowser();
      const page = await browser.newPage();
      const one = await withTimeout(() => fetchFarmaexpress(page, String(req.query.product || '')), 15000);
      await browser.close().catch(()=>{});
      return res.status(200).json({
        ok: false,
        error: 'prices_failed_fallback_one_source',
        product: String(req.query.product || ''),
        sources: [{
          source: 'farmaexpress',
          ok: Array.isArray(one) && one.length > 0,
          count: Array.isArray(one) ? one.length : 0,
          items: (one || []).slice(0, 5),
        }]
      });
    } catch (e2) {
      return res.status(500).json({ ok: false, error: 'prices_failed_and_fallback_failed', detail: String(e2) });
    }
  }
});

// 404 JSON
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'not_found', path: req.path });
});

// Start & shutdown
const server = app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});
process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
async function shutdown() {
  console.log('Shutting down...');
  try { server.close(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
