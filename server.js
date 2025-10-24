// server.js – VIDESAPP API (Render-ready + /prices)
import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import puppeteer from "puppeteer";

// Agrega el agregador principal de precios
import { scrapePrices } from "./scrapers/index.js";

// (Opcional) si mantuviste los debug-parsers por URL individual:
import { fetchCruzVerde } from "./scrapers/cruzverde.js"; // solo si tienes este archivo
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36";

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(compression());
app.use(morgan("tiny"));

const PORT = process.env.PORT || 8080;

// ---------------------------------------------------------------------
// Health & root
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// /prices?q=paracetamol
// Devuelve: { product, averagePrice, count, items[], sources[], errors[] }
// ---------------------------------------------------------------------
app.get("/prices", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ ok: false, error: "q_required" });

    // Llama a tu agregador (con caché interna, timeouts y reintentos)
    const data = await scrapePrices(q);

    return res.json({ ok: true, ...data });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
});

// ---------------------------------------------------------------------
// /debug/scrape?url=...  (útil para probar un link suelto)
// Usa navegador sólo cuando hace falta (ej: Cruz Verde, Ahumada búsqueda)
// ---------------------------------------------------------------------
app.get("/debug/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, error: "url_required" });

  const needsBrowser =
    String(url).includes("cruzverde.cl") ||
    String(url).includes("farmaciasahumada.cl");

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
      if (String(url).includes("cruzverde.cl")) {
        // requiere navegador por la forma de servir el DOM
        result = await fetchCruzVerde(page, String(url));
      } else {
        // Ahumada (búsqueda): devuelve links de productos
        await page.goto(String(url), { waitUntil: "networkidle2", timeout: 60000 });
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
        result = { source: "ahumada-search", url: String(url), links };
      }

      await browser.close();
      return res.json({ ok: true, result });
    }

    // Para otros dominios, /prices es el flujo recomendado.
    return res.status(400).json({
      ok: false,
      error: "use_prices_endpoint",
      hint: "Usa /prices?q=paracetamol para el flujo completo.",
    });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
});

// ---------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------
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
