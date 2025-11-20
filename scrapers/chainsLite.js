// scrapers/chainsLite.js
// Versión "real" usando Puppeteer para scrapear precio por cadena

import puppeteer from "puppeteer";
import {
  robustFirstPrice,
  setPageDefaults,
  safeGoto,
  tryDismissCookieBanners,
  autoScroll,
} from "./utils.js";

const CHAINS = [
  {
    id: "ahumada",
    chainName: "Ahumada",
    searchUrl: (q) =>
      `https://www.farmaciasahumada.cl/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: "cruzverde",
    chainName: "Cruz Verde",
    searchUrl: (q) =>
      `https://www.cruzverde.cl/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: "salcobrand",
    chainName: "Salcobrand",
    searchUrl: (q) =>
      `https://www.salcobrand.cl/search?text=${encodeURIComponent(q)}`,
  },
  {
    id: "drsimi",
    chainName: "Dr. Simi",
    searchUrl: (q) =>
      `https://www.drsimi.cl/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: "farmaexpress",
    chainName: "Farmaexpress",
    searchUrl: (q) =>
      `https://farmex.cl/search?q=${encodeURIComponent(q)}`,
  },
];

function mkMapsUrl(chain, lat = null, lng = null) {
  const base = "https://www.google.com/maps/dir/?api=1";
  const dest = encodeURIComponent("Farmacia " + chain);
  if (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    return `${base}&destination=${dest}&origin=${lat},${lng}&travelmode=driving`;
  }
  return `${base}&destination=${dest}&travelmode=driving`;
}

async function scrapeChain(browser, cfg, q, { lat, lng }) {
  const page = await browser.newPage();
  try {
    await setPageDefaults(page);

    const url = cfg.searchUrl(q);
    const ok = await safeGoto(page, url, 20000);
    if (!ok) {
      return null;
    }

    await tryDismissCookieBanners(page);
    await page.waitForTimeout(1500);
    await autoScroll(page, { steps: 6, delay: 250 });
    await page.waitForTimeout(800);

    const price = await robustFirstPrice(page);
    if (!price || !Number.isFinite(price) || price <= 0) {
      return null;
    }

    return {
      chain: cfg.chainName,
      price,
      url,
      mapsUrl: mkMapsUrl(cfg.chainName, lat, lng),
    };
  } catch (e) {
    if (process.env.DEBUG_PRICES) {
      console.error("[chainsLite] error en cadena", cfg.chainName, e);
    }
    return null;
  } finally {
    try {
      await page.close();
    } catch {}
  }
}

/**
 * Busca precio por cadena usando Puppeteer.
 * Devuelve el mejor precio encontrado por cadena.
 *
 * @param {string} q
 * @param {{lat?: number|null, lng?: number|null}} opts
 */
export async function searchChainPricesLite(q, { lat = null, lng = null } = {}) {
  const started = Date.now();
  const query = String(q || "").trim();
  if (!query) {
    return {
      ok: false,
      query: "",
      count: 0,
      items: [],
      error: "q_required",
    };
  }

  let browser = null;
  const items = [];

  try {
    browser = await puppeteer.launch({
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    // Por ahora lo hacemos secuencial para no matar la RAM en Render
    for (const cfg of CHAINS) {
      const r = await scrapeChain(browser, cfg, query, { lat, lng });
      if (r) items.push(r);
    }
  } catch (e) {
    console.error("[chainsLite] error general", e);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }

  items.sort((a, b) => {
    if (a.price && b.price) return a.price - b.price;
    if (a.price) return -1;
    if (b.price) return 1;
    return 0;
  });

  return {
    ok: true,
    query,
    count: items.length,
    items,
    took_ms: Date.now() - started,
  };
}
