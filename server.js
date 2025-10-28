import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

app.use(compression());
app.use(cors({ origin: "*"}));
app.use(morgan("dev"));

// --------- HEALTH ----------
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "videsapp-api",
    port: PORT,
    node: process.version,
    time: new Date().toISOString(),
  });
});

// --------- SEARCH ----------
app.get("/search", async (req, res) => {
  try {
    const q = (req.query.q || "").toString();
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    const debug = req.query.debug === "1" || req.query.debug === "true";
    const limitPerStore = req.query.limit ? Number(req.query.limit) : 10;

    const { federatedSearchTop1 } = await import("./scrapers/searchFederated.js");
    const out = await federatedSearchTop1(q, { limitPerStore, lat, lng, debug });
    res.json(out);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// --------- SEARCH2 (debug forzado) ----------
app.get("/search2", async (req, res) => {
  try {
    const q = (req.query.q || "").toString();
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    const limitPerStore = req.query.limit ? Number(req.query.limit) : 10;

    const { federatedSearchTop1 } = await import("./scrapers/searchFederated.js");
    const out = await federatedSearchTop1(q, { limitPerStore, lat, lng, debug: true });
    res.json(out);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// --------- DIAG: FETCH ----------
app.get("/diag/fetch", async (req, res) => {
  const url = req.query.url?.toString();
  if (!url) return res.status(400).send("Missing url");
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const text = await r.text();
    res.type("text/plain").send(text.slice(0, 2000));
  } catch (err) {
    res.status(500).send(String(err?.message || err));
  }
});

// --------- DIAG: PUPPETEER ----------
app.get("/diag/puppeteer", async (req, res) => {
  const url = req.query.url?.toString();
  if (!url) return res.status(400).send("Missing url");
  try {
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);
    const html = await page.content();
    await browser.close();
    res.type("text/plain").send(html.slice(0, 2000));
  } catch (err) {
    res.status(500).send(String(err?.message || err));
  }
});

// --------- 404 ----------
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not_found" });
});

// --------- LISTEN ----------
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
