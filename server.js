// server.js (Real data v2: Puppeteer headless)
import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";

const app = express();
app.use(cors());
app.use(express.json());

const WAIT_MS = 9000; // espera para que cargue JS
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari";
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const asNumber = (txt) => {
  if (!txt) return null;
  const n = Number(txt.replace(/\./g, "").replace(/,/g, ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

async function withPage(fn) {
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: "new"
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ "accept-language": "es-CL,es;q=0.9,en;q=0.8" });
    const out = await fn(page);
    await browser.close();
    return out;
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

// ------------ CRUZ VERDE ------------
async function scrapeCruzVerde(product) {
  const url = "https://www.cruzverde.cl/search?q=" + encodeURIComponent(product);
  return withPage(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(WAIT_MS);

    // intenta varios selectores de tarjeta (cambian a menudo)
    const cards = await page.$$(
      ".product-tile, li.product, div.grid-tile, [data-test*='product'], article, .product, .tile"
    );
    const items = [];
    for (const el of cards) {
      const text = norm(await page.evaluate((n) => n.innerText || "", el));
      if (!text) continue;

      // título: primera línea “larga”
      const title =
        text.split("\n").map(norm).find((t) => t && t.length > 6) || null;

      // precio: busca algo con $ o dígitos
      const priceMatch = text.match(/(\$?\s?\d{1,3}(\.\d{3})*(,\d{1,2})?)/);
      const price = priceMatch ? asNumber(priceMatch[0]) : null;

      if (title) {
        items.push({
          source: "cruzverde",
          title,
          price,
          url
        });
      }
    }
    return items;
  });
}

// ------------ SALCOBRAND ------------
async function scrapeSalcobrand(product) {
  const url = "https://salcobrand.cl/search?q=" + encodeURIComponent(product);
  return withPage(async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(WAIT_MS);

    const cards = await page.$$(
      "article, .product-item, .product, li, .card, [data-testid*='product']"
    );
    const items = [];
    for (const el of cards) {
      const text = norm(await page.evaluate((n) => n.innerText || "", el));
      if (!text) continue;

      const title =
        text.split("\n").map(norm).find((t) => t && t.length > 6) || null;
      const priceMatch = text.match(/(\$?\s?\d{1,3}(\.\d{3})*(,\d{1,2})?)/);
      const price = priceMatch ? asNumber(priceMatch[0]) : null;

      if (title) {
        items.push({
          source: "salcobrand",
          title,
          price,
          url
        });
      }
    }
    return items;
  });
}

// ------------ merge ------------
async function getRealPrices(query) {
  const [cv, sb] = await Promise.allSettled([
    scrapeCruzVerde(query),
    scrapeSalcobrand(query),
  ]);
  const out = [];
  if (cv.status === "fulfilled") out.push(...cv.value);
  if (sb.status === "fulfilled") out.push(...sb.value);

  // dedup por fuente+titulo
  const seen = new Set();
  const dedup = out.filter((it) => {
    const k = `${it.source}|${it.title?.toLowerCase()}`;
    if (!it.title || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // orden: precio válido primero
  dedup.sort((a, b) => {
    const ap = a.price ?? Infinity;
    const bp = b.price ?? Infinity;
    if (ap !== bp) return ap - bp;
    return a.title.localeCompare(b.title);
  });

  return dedup;
}

// ------------ endpoints ------------
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "videsapp-api", ts: new Date().toISOString() });
});

app.get("/prices", async (req, res) => {
  const product = String(req.query.product || "").trim();
  if (!product) return res.status(400).json({ error: "Falta 'product'." });

  try {
    const items = await getRealPrices(product);
    const prices = items.map(i => i.price).filter((p) => Number.isFinite(p));
    const average = prices.length
      ? Math.round(prices.reduce((s, x) => s + x, 0) / prices.length)
      : null;

    res.json({
      product,
      averagePrice: average,
      count: items.length,
      items,
      sources: ["cruzverde", "salcobrand"],
      note: "Datos reales con navegador headless (Puppeteer); HTML sujeto a cambios."
    });
  } catch (err) {
    console.error("prices error:", err);
    res.status(500).json({ error: "Error al obtener precios", detail: String(err) });
  }
});

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "API VIDESAPP real (v3: Puppeteer)",
    docs: ["/health", "/prices?product=paracetamol", "/prices?product=ketoprofeno"]
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
