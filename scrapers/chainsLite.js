// scrapers/chainsLite.js — lite + VTEX + HTML fallbacks (sin Puppeteer)

import cheerio from "cheerio";

/* ----------------- utilidades comunes ----------------- */
const HOST_TO_CHAIN = {
  "cruzverde.cl": "Cruz Verde",
  "www.cruzverde.cl": "Cruz Verde",
  "salcobrand.cl": "Salcobrand",
  "www.salcobrand.cl": "Salcobrand",
  "farmaciasahumada.cl": "Ahumada",
  "www.farmaciasahumada.cl": "Ahumada",
  "drsimi.cl": "Dr. Simi",
  "www.drsimi.cl": "Dr. Simi",
  "farmex.cl": "Farmaexpress",
  "www.farmex.cl": "Farmaexpress",
};

const LOGOS = {
  "Cruz Verde": "https://static-videsapp.s3.amazonaws.com/logos/cruzverde.png",
  Salcobrand: "https://static-videsapp.s3.amazonaws.com/logos/salcobrand.png",
  Ahumada: "https://static-videsapp.s3.amazonaws.com/logos/ahumada.png",
  "Dr. Simi": "https://static-videsapp.s3.amazonaws.com/logos/drsimi.png",
  Farmaexpress: "https://static-videsapp.s3.amazonaws.com/logos/farmaexpress.png",
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const headers = {
  "User-Agent": UA,
  "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parsePriceCLP(input) {
  if (input == null) return null;
  const s = String(input)
    .replace(/\u00A0/g, " ")
    .replace(/CLP/gi, "")
    .replace(/pesos?/gi, "")
    .replace(/[^\d.,]/g, "")
    .trim();
  if (!s) return null;
  const normalized = s.replace(/\./g, "").replace(/,/g, "");
  const n = Number.parseInt(normalized, 10);
  if (!Number.isFinite(n)) return null;
  if (n < 100 || n > 500000) return null;
  return n;
}

function pickPriceFromHtml(textOrHtml) {
  if (!textOrHtml) return null;
  const str = String(textOrHtml).replace(/\u00A0/g, " ");
  const re = /(?:CLP|\$)?\s*\d{1,3}(?:[.\s]\d{3})+|\d{4,6}/g;
  let best = null;
  for (const m of str.matchAll(re)) {
    const p = parsePriceCLP(m[0]);
    if (p && (best == null || p < best)) best = p;
  }
  return best;
}

function mkMapsUrl(lat = null, lng = null, label = "") {
  const base = "https://www.google.com/maps/dir/?api=1";
  const name = encodeURIComponent(label || "");
  if (lat != null && lng != null) return `${base}&destination=${lat},${lng}&destination_name=${name}`;
  return `${base}&destination=${name}`;
}

async function fetchTxt(url, { timeoutMs = 9000, h = headers } = {}) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: h, signal: ac.signal });
    return await r.text();
  } finally {
    clearTimeout(to);
  }
}

async function fetchJson(url, { timeoutMs = 9000, h = headers } = {}) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { ...h, accept: "application/json" }, signal: ac.signal });
    if (!r.ok) return null;
    return await r.json();
  } finally {
    clearTimeout(to);
  }
}

/* ----------------- VTEX helpers (Cruz Verde, Salcobrand, Farmaexpress) ----------------- */
async function vtexSearch(baseUrl, q) {
  // 1) intelligent-search
  const u1 = new URL("/_v/api/intelligent-search/product_search/v1/", baseUrl);
  u1.searchParams.set("ft", q);

  // 2) api clásica
  const u2 = new URL(`/api/catalog_system/pub/products/search/${encodeURIComponent(q)}`, baseUrl);

  for (const u of [u1, u2]) {
    const j = await fetchJson(u.toString()).catch(() => null);
    if (Array.isArray(j) && j.length) {
      const items = [];
      for (const p of j) {
        const title = p?.productName || p?.productTitle || p?.productNameWithTag || "";
        const sku = p?.items?.[0];
        const seller = sku?.sellers?.[0];
        const price =
          seller?.commertialOffer?.Price ??
          seller?.commertialOffer?.price ??
          p?.items?.[0]?.sellers?.[0]?.commertialOffer?.Price ??
          null;

        let link = null;
        if (p?.link) link = p.link;
        else if (p?.linkText) link = `/${p.linkText}/p`;

        const px = parsePriceCLP(price);
        if (title && px) items.push({ title, price: px, url: link ? new URL(link, baseUrl).toString() : null });
      }
      if (items.length) return items;
    }
    await sleep(150);
  }
  return [];
}

/* ----------------- Scrapers por cadena ----------------- */
async function scrapeCruzVerde(q) {
  const base = "https://www.cruzverde.cl";
  const items = await vtexSearch(base, q);
  return items.map((x) => ({
    chain: "Cruz Verde",
    name: x.title,
    price: x.price,
    url: x.url,
    logoUrl: LOGOS["Cruz Verde"],
  }));
}

async function scrapeSalcobrand(q) {
  const base = "https://www.salcobrand.cl";
  const items = await vtexSearch(base, q);
  return items.map((x) => ({
    chain: "Salcobrand",
    name: x.title,
    price: x.price,
    url: x.url,
    logoUrl: LOGOS["Salcobrand"],
  }));
}

async function scrapeFarmaexpress(q) {
  const base = "https://farmex.cl";
  const items = await vtexSearch(base, q);
  return items.map((x) => ({
    chain: "Farmaexpress",
    name: x.title,
    price: x.price,
    url: x.url,
    logoUrl: LOGOS["Farmaexpress"],
  }));
}

async function scrapeDrSimi(q) {
  // HTML simple de resultados
  const url = `https://www.drsimi.cl/search?q=${encodeURIComponent(q)}`;
  const html = await fetchTxt(url).catch(() => "");
  if (!html) return [];

  const $ = cheerio.load(html);
  const items = [];
  $(".product-grid .product-item, .product__item, .grid__item").each((_, el) => {
    const name =
      $(el).find(".product-item__title, .product-title, .card-title, a[href*='/products/']").first().text().trim() ||
      "";
    const priceTxt =
      $(el)
        .find(
          ".price__current, .price--highlight, .price-item--regular, .price, .product-price, [class*='price']"
        )
        .first()
        .text() || $(el).text();

    const href =
      $(el).find("a[href*='/products/']").attr("href") ||
      $(el).find("a").attr("href") ||
      null;

    const price = parsePriceCLP(priceTxt) ?? pickPriceFromHtml(priceTxt);
    if (name && price) {
      items.push({
        chain: "Dr. Simi",
        name,
        price,
        url: href ? new URL(href, "https://www.drsimi.cl").toString() : null,
        logoUrl: LOGOS["Dr. Simi"],
      });
    }
  });

  return items;
}

/* --------------- Fallback Google (r.jina.ai) --------------- */
async function searchGoogleCheap(q) {
  const g = `https://r.jina.ai/http://www.google.com/search?q=${encodeURIComponent(
    `${q} precio (site:cruzverde.cl OR site:salcobrand.cl OR site:drsimi.cl OR site:farmex.cl)`
  )}&hl=es-CL&num=30`;

  const text = await fetchTxt(g, { timeoutMs: 8000 }).catch(() => "");
  if (!text) return [];

  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const chunk = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(" ");
    const urls = [...chunk.matchAll(/https?:\/\/[^\s\)\]]+/g)].map((m) => m[0]);
    if (!urls.length) continue;
    const price = pickPriceFromHtml(chunk);
    if (!price) continue;
    for (const u of urls) {
      let host = "";
      try {
        host = new URL(u).host;
      } catch {}
      const chain = HOST_TO_CHAIN[host];
      if (!chain) continue;
      out.push({
        chain,
        name: q,
        price,
        url: u,
        logoUrl: LOGOS[chain],
      });
    }
  }
  return out;
}

/* ----------------- merge & top-1 por cadena ----------------- */
function top1ByChain(rows) {
  const map = new Map();
  for (const r of rows) {
    const prev = map.get(r.chain);
    if (!prev || (Number.isFinite(r.price) && r.price < prev.price)) map.set(r.chain, r);
  }
  return [...map.values()].sort((a, b) => {
    if (a.price && b.price) return a.price - b.price;
    if (a.price) return -1;
    if (b.price) return 1;
    return 0;
  });
}

/* ----------------- API pública de este módulo ----------------- */
export async function searchChainPricesLite(q, { lat = null, lng = null } = {}) {
  const started = Date.now();
  const HARD_MS = 12000;

  const tasks = [
    scrapeSalcobrand(q),
    scrapeCruzVerde(q),
    scrapeFarmaexpress(q),
    scrapeDrSimi(q),
  ].map((p) =>
    p.catch(() => [])
  );

  // ejecutamos en paralelo con límite duro
  let results = [];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HARD_MS);

  try {
    const partial = await Promise.race([
      Promise.all(tasks),
      new Promise((_, rej) => {
        const t = setTimeout(() => rej(new Error("timeout")), HARD_MS);
        // guardamos el timer para limpiar luego
        results._t = t;
      }),
    ]).catch(() => []);

    // combinar
    for (const arr of partial || []) if (Array.isArray(arr)) results.push(...arr);
  } finally {
    clearTimeout(timer);
    if (results._t) clearTimeout(results._t);
  }

  // si no encontramos nada, intentamos Google liviano
  if (!results.length) {
    const g = await searchGoogleCheap(q).catch(() => []);
    results.push(...g);
  }

  const uniq = top1ByChain(results).map((r) => ({
    chain: r.chain,
    name: r.name || q,
    price: r.price ?? null,
    url: r.url || null,
    logoUrl: r.logoUrl || null,
    mapsUrl: mkMapsUrl(lat, lng, r.chain),
  }));

  return {
    ok: true,
    query: q,
    count: uniq.length,
    items: uniq.slice(0, 8),
    took_ms: Date.now() - started,
  };
}
