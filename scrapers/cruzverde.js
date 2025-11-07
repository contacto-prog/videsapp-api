// cruzverde.js
const puppeteer = require("puppeteer");

const DEFAULTS = {
  headless: true,
  timeoutMs: 45000,
  navTimeoutMs: 35000,
  navigationUrl: "https://beta.cruzverde.cl/",
  pageSize: 24,
  maxProducts: 200,
  viewport: { width: 1366, height: 900 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

function normalizeItem(item) {
  const id = item?.id || item?.product_id || item?.c_productId || null;
  const name = item?.product_name || item?.productName || item?.name || "";
  const url = item?.link || item?.pdp_url || item?.url || null;
  const image = item?.image?.link || item?.image || item?.image_url || null;
  const price = item?.price ?? item?.prices?.price ?? null;
  const salePrice =
    item?.sale_price ?? item?.prices?.sale_price ?? item?.prices?.salePrice ?? null;
  const listPrice = item?.list_price ?? item?.prices?.list_price ?? null;
  const availability =
    item?.in_stock ?? item?.availability ?? item?.available ?? undefined;

  return {
    pharmacy: "Cruz Verde",
    id,
    name,
    url,
    image,
    price,
    salePrice,
    listPrice,
    availability,
    raw: item,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetries(fn, { retries = 2, baseDelayMs = 800 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); } 
    catch (err) {
      lastErr = err;
      if (i < retries) await sleep(Math.round(baseDelayMs * Math.pow(1.6, i) + Math.random() * 250));
    }
  }
  throw lastErr;
}

async function ensureBetaSession(page, navigationUrl) {
  await page.setUserAgent(DEFAULTS.userAgent);
  await page.setViewport(DEFAULTS.viewport);
  await page.setExtraHTTPHeaders({ "Accept-Language": "es-CL,es;q=0.9,en;q=0.8" });
  await page.goto(navigationUrl, {
    waitUntil: ["domcontentloaded", "networkidle2"],
    timeout: DEFAULTS.navTimeoutMs,
  });
  await page.evaluate(() => {
    try { localStorage.setItem("__probe__", Date.now().toString()); } catch {}
  });
}

async function queryProductSearch(page, { q, start = 0, count = DEFAULTS.pageSize }) {
  const url = `https://beta.cruzverde.cl/s/Chile/dw/shop/v19_1/product_search?q=${encodeURIComponent(
    q
  )}&start=${start}&count=${count}`;

  return page.evaluate(async (endpoint) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      const res = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        mode: "cors",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
          Referer: "https://beta.cruzverde.cl/",
          Origin: "https://beta.cruzverde.cl",
          "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText} :: ${t.slice(0, 160)}`);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }, url);
}

/**
 * Función principal (firma estable):
 * fetchCruzVerde(query: string, opts?: { headless?: boolean, maxProducts?: number, pageSize?: number })
 * Devuelve: Array<{ id, name, url, image, price, salePrice, listPrice, availability, raw }>
 */
async function fetchCruzVerde(query, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const browser = await puppeteer.launch({
    headless: cfg.headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
    defaultViewport: cfg.viewport,
  });

  let page;
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(cfg.timeoutMs);

    await ensureBetaSession(page, cfg.navigationUrl);

    const results = [];
    let start = 0;

    while (start < cfg.maxProducts) {
      const data = await withRetries(() =>
        queryProductSearch(page, { q: query, start, count: cfg.pageSize })
      );
      const hits = Array.isArray(data?.hits) ? data.hits : [];
      if (hits.length === 0) break;

      for (const item of hits) {
        results.push(normalizeItem(item));
        if (results.length >= cfg.maxProducts) break;
      }
      if (hits.length < cfg.pageSize) break;
      start += cfg.pageSize;
      await sleep(300 + Math.random() * 250);
    }

    return results;
  } catch (err) {
    // Intenta adjuntar señales útiles si algo falla
    try {
      const cookies = page ? await page.cookies() : [];
      const local = page
        ? await page.evaluate(() => {
            const out = { ls: {}, zone: null };
            try { out.ls = Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])); } catch {}
            try { out.zone = document.cookie; } catch {}
            return out;
          })
        : { ls: {}, zone: null };
      err.extra = { cookies, local };
    } catch {}
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

// Compatibilidad: export default + named + CommonJS
module.exports = fetchCruzVerde;
module.exports.fetchCruzVerde = fetchCruzVerde;
exports.default = fetchCruzVerde;

// CLI rápido: node cruzverde.js "paracetamol 500"
if (require.main === module) {
  (async () => {
    const q = process.argv.slice(2).join(" ") || "paracetamol 500";
    try {
      const items = await fetchCruzVerde(q, { headless: true });
      console.log(JSON.stringify({ ok: true, count: items.length, items }, null, 2));
    } catch (e) {
      console.error("CRUZVERDE_ERROR", e.message);
      if (e.extra) console.error("EXTRA", JSON.stringify(e.extra, null, 2));
      process.exit(1);
    }
  })();
}
