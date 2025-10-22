// server.js (real data v1: CruzVerde + Salcobrand search scrapers)
import express from "express";
import cors from "cors";
import got from "got";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json());

// ---------- helpers ----------
const UA = "MiPharmAPP/1.0 (+https://www.videsapp.com; contacto@videsapp.com)";
const asNumber = (txt) => {
  if (!txt) return null;
  const n = Number(txt.replace(/\./g, "").replace(/,/g, ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const normName = (s) => String(s || "").replace(/\s+/g, " ").trim();

async function fetchHTML(url) {
  return got(url, {
    timeout: { request: 10000 },
    headers: { "user-agent": UA, accept: "text/html, */*" },
    https: { rejectUnauthorized: true },
  }).text();
}

// ---------- provider: CRUZ VERDE ----------
async function searchCruzVerde(query) {
  const url = "https://www.cruzverde.cl/search?q=" + encodeURIComponent(query.trim());
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const items = [];
  $(".product-tile, li.product, div.grid-tile").each((_, el) => {
    const title =
      normName($(el).find(".product-name, .pdp-link, a.name, a.title").text()) ||
      normName($(el).find("a").first().text());
    const priceTxt =
      $(el).find(".product-sales-price, .sales, .price, .value, .sales .value").first().text() ||
      $(el).find("[data-test='product-price']").first().text();
    const price = asNumber(priceTxt);
    if (title) items.push({ source: "cruzverde", title, price, url });
  });
  return items;
}

// ---------- provider: SALCOBRAND ----------
async function searchSalcobrand(query) {
  const url = "https://salcobrand.cl/search?q=" + encodeURIComponent(query.trim());
  let html = "";
  try { html = await fetchHTML(url); } catch { /* ignore */ }
  const $ = cheerio.load(html || "");

  const items = [];
  $("article, .product-item, .product, li, .card").each((_, el) => {
    const title =
      normName($(el).find(".product-title, .title, a.title, h3, h2").first().text()) ||
      normName($(el).find("a").first().text());
    const priceTxt = $(el).find(".price, .product-price, .current-price, .value").first().text();
    const price = asNumber(priceTxt);
    if (title) items.push({ source: "salcobrand", title, price, url });
  });
  return items;
}

// ---------- merge ----------
async function getRealPrices(query) {
  const [cv, sb] = await Promise.allSettled([searchCruzVerde(query), searchSalcobrand(query)]);
  const out = [];
  if (cv.status === "fulfilled") out.push(...cv.value);
  if (sb.status === "fulfilled") out.push(...sb.value);

  const seen = new Set();
  const dedup = out.filter((it) => {
    const k = `${it.source}|${it.title.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  dedup.sort((a, b) => {
    const ap = a.price ?? Infinity;
    const bp = b.price ?? Infinity;
    if (ap !== bp) return ap - bp;
    return a.title.localeCompare(b.title);
  });
  return dedup;
}

// ---------- endpoints ----------
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "videsapp-api", ts: new Date().toISOString() });
});

app.get("/prices", async (req, res) => {
  const product = String(req.query.product || "").trim();
  if (!product) return res.status(400).json({ error: "Falta 'product'." });

  try {
    const items = await getRealPrices(product);
    const prices = items.map(i => i.price).filter(p => Number.isFinite(p));
    const average = prices.length
      ? Math.round(prices.reduce((s, x) => s + x, 0) / prices.length)
      : null;

    res.json({
      product,
      averagePrice: average,
      count: items.length,
      items,
      sources: ["cruzverde", "salcobrand"],
      note: "Resultados obtenidos de buscadores web públicos; su estructura puede cambiar."
    });
  } catch (err) {
    console.error("prices error:", err);
    res.status(500).json({ error: "Error al obtener precios", detail: String(err) });
  }
});

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "API VIDESAPP real (v1: CruzVerde + Salcobrand)",
    docs: ["/health", "/prices?product=paracetamol", "/prices?product=ketoprofeno"]
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
