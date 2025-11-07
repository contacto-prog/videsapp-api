// fetchCruzVerde.js
// Scraper para Cruz Verde usando el host beta.cruzverde.cl
// Objetivo: obtener resultados de producto_search (dw/shop v19_1) con hits[] y precios.
// Probado para ejecutarse dentro del contexto del navegador (page.evaluate) para heredar cookies/sesión del subdominio beta.

const puppeteer = require("puppeteer");

/**
 * Parámetros de control por defecto
 */
const DEFAULTS = {
  headless: "new", // usa "false" para ver el navegador
  timeoutMs: 45_000,
  navTimeoutMs: 35_000,
  navigationUrl: "https://beta.cruzverde.cl/",
  pageSize: 24,
  maxProducts: 200, // tope de seguridad
  viewport: { width: 1366, height: 900 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

/**
 * Estructura estándar de salida
 */
function normalizeItem(item) {
  // Campos relevantes típicos del endpoint product_search
  const id = item?.id || item?.product_id || item?.c_productId || null;
  const name = item?.product_name || item?.productName || item?.name || "";
  const url = item?.link || item?.pdp_url || item?.url || null;
  const image = item?.image?.link || item?.image || item?.image_url || null;
  // prices: puede venir como { price, sale_price, list_price } o en promotions
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

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function withRetries(fn, { retries = 3, baseDelayMs = 800 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // backoff exponencial + jitter
      const delay = Math.round(baseDelayMs * Math.pow(1.6, i) + Math.random() * 250);
      if (i < retries) await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Hace la llamada al endpoint product_search desde dentro del navegador (page.evaluate)
 * para garantizar que cookies/sesión/headers de beta.cruzverde.cl acompañen la petición.
 */
async function queryProductSearch(page, { q, start = 0, count = DEFAULTS.pageSize }) {
  const endpoint =
    `https://beta.cruzverde.cl/s/Chile/dw/shop/v19_1/product_search?q=${encodeURIComponent(
      q
    )}&start=${start}&count=${count}`;

  return await page.evaluate(
    async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 35_000);
      try {
        const res = await fetch(url, {
          method: "GET",
          credentials: "include",
          mode: "cors",
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
            Referer: "https://beta.cruzverde.cl/",
            Origin: "https://beta.cruzverde.cl",
            // DW a veces requiere un header de idioma/país coherente
            "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
          },
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text.slice(0, 180)}`);
        }
        const json = await res.json();
        return json;
      } finally {
        clearTimeout(timer);
      }
    },
    endpoint
  );
}

/**
 * Navega primero al dominio beta para establecer cookies (sid, locale, inventoryZone, etc.).
 */
async function ensureBetaSession(page, navigationUrl = DEFAULTS.navigationUrl) {
  await page.setUserAgent(DEFAULTS.userAgent);
  await page.setViewport(DEFAULTS.viewport);
  await page.setExtraHTTPHeaders({
    "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
  });

  await page.goto(navigationUrl, {
    waitUntil: ["domcontentloaded", "networkidle2"],
    timeout: DEFAULTS.navTimeoutMs,
  });

  // Interactuar levemente para provocar set de cookies/zone si aplica
  await page.evaluate(() => {
    try {
      // algunos sitios requieren tocar localStorage/consent
      localStorage.setItem("__probe__", Date.now().toString());
    } catch {}
  });
}

/**
 * Scraper principal. Retorna una lista normalizada de productos.
 * @param {string} query - término de búsqueda (ej: "paracetamol 500")
 * @param {object} opts
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

    // 1) Establecer sesión en beta
    await ensureBetaSession(page, cfg.navigationUrl);

    // 2) Paginación por bloques
    const results = [];
    let start = 0;
    const pageSize = cfg.pageSize;

    while (start < cfg.maxProducts) {
      const data = await withRetries(() => queryProductSearch(page, { q: query, start, count: pageSize }), {
        retries: 2,
      });

      const hits = data?.hits ?? [];
      if (!Array.isArray(hits) || hits.length === 0) {
        break; // sin más resultados
      }

      for (const item of hits) {
        results.push(normalizeItem(item));
        if (results.length >= cfg.maxProducts) break;
      }

      if (hits.length < pageSize) break;
      start += pageSize;
      // pequeño respiro entre páginas
      await sleep(350 + Math.random() * 300);
    }

    return results;
  } catch (err) {
    // Diagnóstico detallado
    const cookies = page ? await page.cookies().catch(() => []) : [];
    const local = page
      ? await page.evaluate(() => ({
          ls: (() => {
            try {
              return Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));
            } catch {
              return {};
            }
          })(),
          zone: (() => {
            try {
              return (
                window.__zone__ ||
                window?.App?.state?.zone ||
                document.cookie
                  .split("; ")
                  .find((c) => c.startsWith("dwac")) || null
              );
            } catch {
              return null;
            }
          })(),
        }))
      : { ls: {}, zone: null };

    err.extra = { cookies, local };
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

// CLI rápido para pruebas manuales: `node fetchCruzVerde.js "paracetamol 500"`
if (require.main === module) {
  (async () => {
    const q = process.argv.slice(2).join(" ") || "paracetamol 500";
    try {
      const items = await fetchCruzVerde(q, {
        headless: true,
      });
      console.log(JSON.stringify({ ok: true, count: items.length, items }, null, 2));
    } catch (e) {
      console.error("SCRAPER_ERROR", e.message);
      if (e.extra) {
        console.error("EXTRA_DIAGNOSTICS", JSON.stringify(e.extra, null, 2));
      }
      process.exit(1);
    }
  })();
}

module.exports = { fetchCruzVerde };
