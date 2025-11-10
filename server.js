// server.js – VIDESAPP API (prices-lite + federado + nearby)
import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import fs from "fs/promises";
import { searchChainPricesLite } from "./scrapers/chainsLite.js";

const BUILD  = "prices-lite-2025-11-10";
const COMMIT = process.env.RENDER_GIT_COMMIT || null;
const PORT   = process.env.PORT || 8080;

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(compression());
app.use(morgan("tiny"));

// Timeout defensivo
app.use((req, res, next) => {
  res.setTimeout(15000, () => {
    try { res.status(504).json({ ok:false, error:"gateway_timeout" }); } catch {}
  });
  next();
});

// -------------------- Helpers --------------------
function kmBetween(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sLat1 = Math.sin(dLat/2), sLng1 = Math.sin(dLng/2);
  const A = sLat1*sLat1 + Math.cos(a.lat*Math.PI/180) * Math.cos(b.lat*Math.PI/180) * sLng1*sLng1;
  return 2 * R * Math.asin(Math.sqrt(A));
}

function mapsLink(lat, lng, label) {
  const q = encodeURIComponent(label || "");
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_name=${q}`;
}

async function loadStores() {
  const raw = await fs.readFile(new URL("./data/stores.json", import.meta.url), "utf-8");
  return JSON.parse(raw);
}

const norm = (s) =>
  (s || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, "").replace(/farmacia(s)?/g, "");

// -------------------- Health --------------------
app.get("/", (_req, res) => res.type("text/plain").send("VIDESAPP API – OK"));
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "videsapp-api",
    build: BUILD,
    commit: COMMIT,
    port: PORT,
    node: process.version,
    time: new Date().toISOString(),
  });
});
app.get("/prices-lite-ping", (_req, res) => {
  res.json({ ok: true, ping: "prices-lite", build: BUILD });
});

// -------------------- precios-lite --------------------
app.get("/prices-lite", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    if (!q) return res.status(400).json({ ok:false, error:"q_required" });
    const data = await searchChainPricesLite(q, { lat, lng });
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok:false, error:String(err?.message || err) });
  }
});

// Compat: /search2 -> precios-lite
app.get("/search2", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    if (!q) return res.status(400).json({ ok:false, error:"q_required" });
    const data = await searchChainPricesLite(q, { lat, lng });
    res.json({ ok:true, q, count: data.count, items: data.items });
  } catch (err) {
    res.status(500).json({ ok:false, error:String(err?.message || err) });
  }
});

// -------------------- federado --------------------
app.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ ok: false, error: "q_required" });

    const lat = Number(req.query.lat || process.env.GEO_LAT || -33.4489);
    const lng = Number(req.query.lng || process.env.GEO_LNG || -70.6693);
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY || "";

    // nuevo federado (fetchFederated.js)
    const { searchFederated } = await import("./fetchFederated.js");
    const results = await searchFederated({ q, lat, lng, mapsKey });

    res.json({
      ok: true,
      q,
      count: results.length,
      items: results.map(r => ({
        pharmacy: r.pharmacy,          // "ahumada", "cruzverde", etc.
        name: r.name,                  // producto o "sin información"
        price: r.price,                // puede ser null
        distance_km: r.distance_km,    // número o null
        maps_url: r.maps_url           // link "Cómo llegar"
      }))
    });
  } catch (err) {
    console.error("Error en /search", err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// API oficial: precios federados (lista completa)
app.get("/api/prices", async (req, res) => {
  try {
    // Aceptar q= o product= (compatibilidad con la app)
    const q = String(req.query.q || req.query.product || "").trim();

    // lat/lng siguen igual (radius es opcional; si viene lo ignoramos por ahora)
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;

    if (!q) return res.status(400).json({ ok:false, error:"q_required" });

    const { searchFederated } = await import("./scrapers/searchfederated.js");

    const items = await searchFederated(q, {
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    });

    res.json({
      ok: true,
      q,
      count: items.length,
      items: items.map((r) => ({
        store: r.store,   // "Cruz Verde", "Salcobrand", etc.
        name:  r.name,
        price: r.price,
        url:   r.url || null,   // botón "Ir"
        stock: r.stock ?? true, // default: true
      })),
      lat, lng,
    });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
});


// -------------------- nearby --------------------
app.get("/nearby", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!q)  return res.status(400).json({ ok:false, error:"q_required" });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok:false, error:"lat_lng_required" });
    }

    const prices = await searchChainPricesLite(q, { lat, lng });
    const stores = await loadStores();

    const user = { lat, lng };
    const rows = [];
    for (const it of (prices.items || [])) {
      const chain = it.chain || "";
      const nc = norm(chain);
      const pool = stores.filter((s) => {
        const nb = norm(s.brand);
        return nb.includes(nc) || nc.includes(nb);
      });
      if (!pool.length) continue;

      let best = null, bestKm = Infinity;
      for (const s of pool) {
        const km = kmBetween(user, { lat: s.lat, lng: s.lng });
        if (km < bestKm) { bestKm = km; best = s; }
      }
      if (!best) continue;

      rows.push({
        brand: chain,
        price: it.price ?? null,
        storeName: best.name,
        address: best.address,
        distance_km: Math.round(bestKm * 10) / 10,
        mapsUrl: mapsLink(best.lat, best.lng, `${best.name} ${best.address}`),
        productUrl: it.url || null,
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

// -------------------- 404 --------------------
app.use((req, res) =>
  res.status(404).json({ ok:false, error:"not_found", path: req.path })
);

// -------------------- start & shutdown --------------------
const server = app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Server listening on http://0.0.0.0:${PORT}`, { BUILD, COMMIT })
);

// sube el timeout a 30s
server.setTimeout?.(30000);

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
