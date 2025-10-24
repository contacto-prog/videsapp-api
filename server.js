// server.js  —  SAFE MODE (no carga puppeteer al boot)
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';

// IMPORTS DE SCRAPERS TAMBIÉN EN DIFERIDO (DINÁMICOS)
// para evitar que Node cargue mucho en el arranque y cause 502
let scrapersLoaded = false;
let SOURCES = [];

async function loadScrapers() {
  if (scrapersLoaded) return;
  const { sourceId: ahumadaId, fetchAhumada } = await import('./scrapers/ahumada.js');
  const { sourceId: cruzverdeId, fetchCruzVerde } = await import('./scrapers/cruzverde.js');
  const { sourceId: farmaId, fetchFarmaexpress } = await import('./scrapers/farmaexpress.js');
  const { sourceId: drsimiId, fetchDrsimi } = await import('./scrapers/drsimi.js');
  const { sourceId: salcoId, fetchSalcobrand } = await import('./scrapers/salcobrand.js');
  SOURCES = [
    { id: ahumadaId, run: fetchAhumada },
    { id: cruzverdeId, run: fetchCruzVerde },
    { id: farmaId, run: fetchFarmaexpress },
    { id: drsimiId, run: fetchDrsimi },
    { id: salcoId, run: fetchSalcobrand },
  ];
  scrapersLoaded = true;
}

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(compression());
app.use(morgan('tiny'));

const PORT = process.env.PORT || 10000;
const ENABLE_SCRAPER = (process.env.ENABLE_SCRAPER || 'true') === 'true';
const ENV_TIMEOUT = Number(process.env.PER_SOURCE_TIMEOUT_MS || 25000);
const ENV_CONCURRENCY = Math.min(Math.max(Number(process.env.SCRAPER_CONCURRENCY || 2), 1), 4);

// Helpers
function withTimeout(promiseFactory, ms) {
  const t = new Promise((_, rej) => setTimeout(() => rej(new Error('source_timeout')), ms));
  return Promise.race([promiseFactory(), t]);
}
function avg(nums) {
  const arr = nums.filter(Number.isFinite);
  if (!arr.length) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
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

// LAZY puppeteer
async function launchBrowser() {
  const puppeteer = (await import('puppeteer')).default;
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

// Root y health (si esto falla, no es Puppeteer)
app.get('/', (_req, res) => {
  res.type('text/plain').send('VIDESAPP API – OK. Usa /health o /prices?product=paracetamol');
});
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'videsapp-prices', enableScraper: ENABLE_SCRAPER, node: process.version, time: new Date().toISOString() });
});

// Debug sin tocar Puppeteer
app.get('/debug/ping', (_req, res) => res.json({ ok: true, pong: Date.now() }));

// Debug Puppeteer (lazy import)
app.get('/debug/puppeteer', async (_req, res) => {
  try {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const title = await page.title().catch(() => null);
    await browser.close().catch(()=>{});
    res.json({ ok: true, title });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Endpoint principal
app.get('/prices', async (req, res) => {
  res.setTimeout(120000);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  // Si el scraper está deshabilitado por env, no intentamos lanzar Puppeteer
  if (!ENABLE_SCRAPER) {
    return res.status(503).json({ ok: false, error: 'scraper_disabled' });
  }

  try {
    const product = String(req.query.product || '').trim();
    if (!product) return res.status(400).json({ ok: false, error: 'missing_param_product' });

    // filtros
    const only = (req.query.only || '').toString().split(',').map(s => s.trim()).filter(Boolean);
    const include = (req.query.include || '').toString().split(',').map(s => s.trim()).filter(Boolean);
    const conc = Math.min(Math.max(Number(req.query.conc || ENV_CONCURRENCY), 1), 4);
    const perSourceTimeout = Math.max(5000, Number(req.query.timeout || ENV_TIMEOUT));

    await loadScrapers();
    let sources = SOURCES;
    if (only.length) {
      const set = new Set(only);
      sources = SOURCES.filter(s => set.has(s.id));
      if (!sources.length) return res.status(400).json({ ok: false, error: 'invalid_only_filter', only });
    } else if (include.length) {
      const set = new Set(include);
      sources = SOURCES.filter(s => set.has(s.id));
      if (!sources.length) return res.status(400).json({ ok: false, error: 'invalid_include_filter', include });
    }

    const started = Date.now();
    const browser = await launchBrowser();

    try {
      const results = await runWithConcurrency(sources, conc, async (src) => {
        const t0 = Date.now();
        let page;
        try {
          page = await browser.newPage();
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
          return {
            source: src.id, ok: true,
            count: mapped.length,
            avg: prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : null,
            tookMs: Date.now() - t0,
            items: mapped,
          };
        } catch (e) {
          return { source: src.id, ok: false, error: String(e?.message || e), count: 0, tookMs: Date.now() - t0, items: [] };
        } finally {
          try { if (page) await page.close(); } catch {}
        }
      });

      const allPrices = results.flatMap(r => r.items.map(x => x.price));
      return res.json({
        ok: true,
        product,
        tookMs: Date.now() - started,
        concurrency: conc,
        perSourceTimeoutMs: perSourceTimeout,
        average: avg(allPrices),
        sources: results,
      });
    } finally {
      try { await browser.close(); } catch {}
    }
  } catch (err) {
    // fallback: responde 200 con error claro (evita 502)
    return res.status(200).json({ ok: false, error: 'prices_failed', detail: String(err) });
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
async function shutdown() { try { server.close(); } catch {} process.exit(0); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
