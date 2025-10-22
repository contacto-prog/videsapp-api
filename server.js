import express from "express";
import cors from "cors";
import { chromium } from "playwright";

const app = express();
app.use(cors());
app.use(express.json());

// ---- utilidades ----
const WAIT = 8000; // ms para esperar que cargue JS
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari";

// Normaliza texto
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const asNumber = (txt) => {
  if (!txt) return null;
  const n = Number(txt.replace(/\./g, "").replace(/,/g, ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Extrae items en la página según varios selectores candidatos
async function extractProducts(page, candidates) {
  for (const sel of candidates) {
    const cards = await page.$$(sel);
    if (cards.length) {
      const out = [];
      for (const el of cards) {
        const title = norm(await el.textContent().catch(() => "")) || null;

        // Intentar encontrar un precio cercano dentro de la misma tarjeta
        const priceNode = await el.$(":text-matches('/\\$|\\d/', 'i')");
        let priceText = null;
        if (priceNode) priceText = await priceNode.textContent().catch(() => null);

        out.push({
          title,
          price: asNumber(priceText),
        });
      }
      // filtra sine título
      return out.filter(i => i.title);
    }
  }
  return [];
}

// ---- proveedores ----
async function scrapeCruzVerde(product, browser) {
  const url = "https://www.cruzverde.cl/search?q=" + encodeURIComponent(product);
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  // esperar red (JS) y contenido
  await page.waitForTimeout(WAIT);

  const items = await extractProducts(page, [
    ".product-tile", "li.product", "div.grid-tile", "[data-test*='product']",
  ]);
  await ctx.close();
  return items.map(i => ({ source: "cruzverde", ...i, url }));
}

async function scrapeSalcobrand(product, browser) {
  const url = "https://salcobrand.cl/search?q=" + encodeURIComponent(product);
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(WAIT);

  const items = await extractProducts(page, [
    "article", ".product-item", ".product", "li", ".card", "[data-testid*='product']",
  ]);
  await ctx.close();
  return items.map(i => ({ source: "salcobrand", ...i, url }));
}

// ---- endpoint health ----
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "videsapp-api", ts: new Date().toISOString() });
});

// ---- endpoint prices ----
app.get("/prices", async (req, res) => {
  const product = String(req.query.product || "").trim();
  if (!product) return res.status(400).json({ error: "Falta 'product'." });

  let browser;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
    });

    // corre proveedores en paralelo
    const [cv, sb] = await Promise.allSettled([
      scrapeCruzVerde(product, browser),
      scrapeSalcobrand(product, browser),
    ]);

    const out = [];
    if (cv.status === "fulfilled") out.push(...cv.value);
    if (sb.status === "fulfilled") out.push(...sb.value);

    // limpieza: dedup por source+title
    const seen = new Set();
    const dedup = out.filter((it) => {
      const k = `${it.source}|${it.title.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // ordena: por precio válido y luego alfabético
    dedup.sort((a, b) => {
      const ap = a.price ?? Infinity;
      const bp = b.price ?? Infinity;
      if (ap !== bp) return ap - bp;
      return a.title.localeCompare(b.title);
    });

    const prices = dedup.map(i => i.price).filter(p => Number.isFinite(p));
    const average = prices.length
      ? Math.round(prices.reduce((s, x) => s + x, 0) / prices.length)
      : null;

    res.json({
      product,
      averagePrice: average,
      count: dedup.length,
      items: dedup,
      sources: ["cruzverde", "salcobrand"],
      note: "Datos extraídos con navegador headless; sujetos a cambios de HTML/anti-bot."
    });
  } catch (err) {
    console.error("prices error:", err);
    res.status(500).json({ error: "Error al obtener precios", detail: String(err) });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// raíz
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "API VIDESAPP real (v2: Playwright)",
    docs: ["/health", "/prices?product=paracetamol", "/prices?product=ketoprofeno"]
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
