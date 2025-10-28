// server.js – VIDESAPP API (Search federado top-1 por farmacia)
import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import fs from "fs/promises";
import { federatedSearchTop1 } from "./scrapers/searchFederated.js";

const app = express();
app.set("trust proxy", 1);

app.get('/diag/fetch', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');
  try {
    const r = await fetch(url);
    const text = await r.text();
    res.type('text/plain').send(text.slice(0, 1000));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/diag/puppeteer', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { timeout: 30000 });
    const html = await page.content();
    res.type('text/plain').send(html.slice(0, 1000));
  } catch (err) {
    res.status(500).send(err.message);
  } finally {
    await browser.close();
  }
});

app.get('/search2', async (req, res) => {
      try {
        const q = (req.query.q || '').toString();
        const lat = req.query.lat ? Number(req.query.lat) : null;
        const lng = req.query.lng ? Number(req.query.lng) : null;
        const limitPerStore = req.query.limit ? Number(req.query.limit) : 10;
        const { federatedSearchTop1 } = await import('./scrapers/searchFederated.js');
        const out = await federatedSearchTop1(q, { limitPerStore, lat, lng, debug: true });
        res.json(out);
      } catch (err) {
        res.status(500).json({ ok:false, error: String(err?.message || err) });
      }
    });

app.use(cors());
app.use(compression());
app.use(morgan("tiny"));

const PORT = process.env.PORT || 8080;

// -------- Helpers para /nearby (opcional en tu app) --------
function kmBetween(a, b) {
  const R=6371, dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180;
  const sLat1=Math.sin(dLat/2), sLng1=Math.sin(dLng/2);
  const A=sLat1*sLat1 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*sLng1*sLng1;
  return 2*R*Math.asin(Math.sqrt(A));
}
function mapsLink(lat,lng,label){
  const q = encodeURIComponent(label || "");
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_name=${q}`;
}
async function loadStores() {
  const raw = await fs.readFile(new URL('./data/stores.json', import.meta.url), 'utf-8');
  return JSON.parse(raw);
}

// -------- Raíz y health --------
app.get("/", (_req, res) => res.type("text/plain").send("VIDESAPP API – OK"));
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "videsapp-api", port: PORT, node: process.version, time: new Date().toISOString() });
});

// -------- NUEVO: /search → top-1 por farmacia --------
app.get('/search', async (req, res) => {
    try {
      const q = (req.query.q || '').toString();
      const lat = req.query.lat ? Number(req.query.lat) : null;
      const lng = req.query.lng ? Number(req.query.lng) : null;
      const debug = req.query.debug === '1' || req.query.debug === 'true';
      const limitPerStore = req.query.limit ? Number(req.query.limit) : 10;
      const { federatedSearchTop1 } = await import('./scrapers/searchFederated.js');
      const out = await federatedSearchTop1(q, { limitPerStore, lat, lng, debug });
      res.json(out);
    } catch (err) {
      res.status(500).json({ ok:false, error: String(err?.message || err) });
    }
  });
    const data = await federatedSearchTop1(q);
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok:false, error:String(err?.message || err) });
  }
});

// -------- /nearby (precio + sucursal más cercana + "Cómo llegar") --------
// Uso: /nearby?q=paracetamol&lat=-33.45&lng=-70.65
app.get("/nearby", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!q)  return res.status(400).json({ ok:false, error:"q_required" });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok:false, error:"lat_lng_required" });
    }

    const [search, stores] = await Promise.all([federatedSearchTop1(q), loadStores()]);
    const user = { lat, lng };
    const rows = [];

    for (const it of (search.items || [])) {
      const pool = stores.filter(s => s.brand.toLowerCase() === (it.source||"").toLowerCase());
      if (!pool.length) continue;
      let best = null, bestKm = Infinity;
      for (const s of pool) {
        const km = kmBetween(user, {lat:s.lat, lng:s.lng});
        if (km < bestKm) { bestKm = km; best = s; }
      }
      if (!best) continue;
      rows.push({
        brand: it.source,
        name: it.name,
        price: it.price ?? null,
        address: best.address,
        storeName: best.name,
        distance_km: Math.round(bestKm*10)/10,
        mapsUrl: mapsLink(best.lat, best.lng, `${best.name} ${best.address}`)
      });
    }

    rows.sort((a,b)=>{
      if (a.price && b.price) return a.price - b.price;
      if (a.price) return -1;
      if (b.price) return 1;
      return a.distance_km - b.distance_km;
    });

    res.json({ ok:true, q, count: rows.length, items: rows });
  } catch (err) {
    res.status(500).json({ ok:false, error:String(err?.message || err) });
  }
});

// 404
app.use((req, res) => res.status(404).json({ ok:false, error:"not_found", path:req.path }));

const server = app.listen(PORT, () => console.log(`✅ Server listening on port ${PORT}`));
function shutdown(){ try { server.close(()=>process.exit(0)); setTimeout(()=>process.exit(0), 2000);} catch { process.exit(0);} }
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// ====== DIAGNÓSTICO RÁPIDO ======
import fetch from "node-fetch";

app.get("/diag/fetch", async (req, res) => {
  try {
    const url = String(req.query.url || "");
    if (!url) return res.status(400).json({ ok:false, error:"url_required" });
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36",
        "Accept-Language": "es-CL,es;q=0.9"
      }
    });
    const text = await r.text();
    res.json({
      ok: true,
      status: r.status,
      length: text.length,
      snippet: text.slice(0, 500)
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

app.get("/diag/puppeteer", async (req, res) => {
  try {
    const url = String(req.query.url || "");
    if (!url) return res.status(400).json({ ok:false, error:"url_required" });
    const puppeteer = (await import("puppeteer")).default;
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]
    });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language":"es-CL,es;q=0.9" });
    await page.goto(url, { waitUntil:"networkidle2", timeout: 60000 });
    const title = await page.title();
    const bodyText = await page.evaluate(()=>document.body?.innerText?.slice(0,1000) || "");
    await browser.close();
    res.json({ ok:true, title, hasBody: !!bodyText, bodySnippet: bodyText.slice(0,200) });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

// Forzar debug del federador
app.get("/search2", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ ok:false, error:"q_required" });
    const { federatedSearchTop1 } = await import("./scrapers/searchFederated.js");
    const data = await federatedSearchTop1(q, { debug: true });
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});
