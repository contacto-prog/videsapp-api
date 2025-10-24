// server.js – VIDESAPP API (Render-ready)
import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";

// Parsers (asegúrate de tener estos archivos tal como te los pasé)
import { parseSalcobrand } from "./scrapers/salcobrand.js";
import { parseDrSimi } from "./scrapers/drsimi.js";
import { parseFarmex } from "./scrapers/farmex.js";
import { parseAhumadaSearch } from "./scrapers/ahumada.js";
import { fetchCruzVerde } from "./scrapers/cruzverde.js";

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(compression());
app.use(morgan("tiny"));

const PORT = process.env.PORT || 8080;

app.get("/", (_req, res) => {
  res.type("text/plain").send("VIDESAPP API – OK");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "videsapp-api",
    port: PORT,
    node: process.version,
    time: new Date().toISOString(),
  });
});

// Helpers
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36";

async function fetchText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "es-CL,es;q=0.9" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

function normalizeFromText(text) {
  const strength = text.match(/(\d+)\s*mg/i)?.[1] ?? null;
  const pack =
    text.match(/\b(\d+)\s*(Comprimidos?|Tabletas?|Cápsulas?)\b/i)?.[1] ?? null;
  const form =
    text.match(/\d+\s*(Comprimidos?|Tabletas?|Cápsulas?)/i)?.[1] ?? null;
  const anyPrice = text.match(/\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/);
  const toNumber = (s) =>
    s ? Number(s.replace(/\$/g, "").replace(/\./g, "").replace(",", ".")) : undefined;
  return {
    strength_mg: strength ? Number(strength) : undefined,
    pack,
    form,
    price: anyPrice ? toNumber(anyPrice[0]) : undefined,
  };
}

async function scrapeDirect(url) {
  const html = await fetchText(url);
  if (url.includes("salcobrand.cl")) return parseSalcobrand(html, url);
  if (url.includes("drsimi.cl")) return parseDrSimi(html, url);
  if (url.includes("farmex.cl")) return parseFarmex(html, url);

  // Fallback genérico (si agregas nuevos dominios sin parser aún)
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return {
    source: new URL(url).hostname.replace(/^www\./, ""),
    url,
    name: $("h1").first().text().trim() || text.slice(0, 120),
    active: /paracetamol/i.test(text) ? "Paracetamol" : undefined,
    ...normalizeFromText(text),
    availability: /Agregar al carro|Disponible/i.test(text)
      ? "in_stock"
      : /Agotado|No disponible|Sin stock/i.test(text)
      ? "out_of_stock"
      : "unknown",
  };
}

// DEBUG: scraper unificado por URL
app.get("/debug/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, error: "url_required" });

  const needsBrowser =
    url.includes("cruzverde.cl") || url.includes("farmaciasahumada.cl");

  try {
    if (needsBrowser) {
      const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.setExtraHTTPHeaders({ "Accept-Language": "es-CL,es;q=0.9" });

      let result;

      if (url.includes("cruzverde.cl")) {
        result = await fetchCruzVerde(page, url);
      } else {
        // Ahumada: si es búsqueda, devolvemos links de productos
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        const links = await page.evaluate(() => {
          const out = [];
          document.querySelectorAll("a").forEach((a) => {
            const href = a.getAttribute("href") || "";
            if (
              /\/product|\/products|\/medicamento|\/producto/i.test(href) &&
              !href.includes("#")
            ) {
              try {
                out.push(new URL(href, location.href).toString());
              } catch {}
            }
          });
          return Array.from(new Set(out)).slice(0, 5);
        });
        result = { source: "ahumada-search", url, links };
      }

      await browser.close();
      return res.json({ ok: true, result });
    }

    const result = await scrapeDirect(url);
    return res.json({ ok: true, result });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not_found", path: req.path });
});

const server = app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});

function shutdown() {
  try {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  } catch {
    process.exit(0);
  }
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
