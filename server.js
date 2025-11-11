// server.js – VIDESAPP API (enriquecido con sucursal más cercana por cadena)
import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import fs from "fs/promises";
import { searchChainPricesLite } from "./scrapers/chainsLite.js";

const BUILD  = "prices-lite-2025-11-11-nearest";
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

function mapsUrlFor(lat, lng, label) {
  const name = encodeURIComponent(label || "");
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_name=${name}`;
}

async function loadStores() {
  const raw = await fs.readFile(new URL("./data/stores.json", import.meta.url), "utf-8");
  return JSON.parse(raw);
}

// normalización simple para cruzar cadenas
function normBrand(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\./g, "")
    .replace(/\s+/g, "")
    .replace(/farmacia(s)?/g, "");
}

// Logo por cadena (ajústalos si quieres otras URLs)
const LOGOS = {
  "ahumada":       "https://static-videsapp.s3.amazonaws.com/logos/ahumada.png",
  "cruzverde":     "https://static-videsapp.s3.amazonaws.com/logos/cruzverde.png",
  "salcobrand":    "https://static-videsapp.s3.amazonaws.com/logos/salcobrand.png",
  "farmaexpress":  "https://static-videsapp.s3.amazonaws.com/logos/farmaexpress.png",
  "drsimi":        "https://static-videsapp.s3.amazonaws.com/logos/drsimi.png",
};

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

// -------------------- precios-lite (sin enriquecer) --------------------
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

// -------------------- federado (top-1 por cadena) --------------------
app.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ ok: false, error: "q_required" });

    const lat = Number(req.query.lat || process.env.GEO_LAT || -33.4489);
    const lng = Number(req.query.lng || process.env.GEO_LNG || -70.6693);

    // Intento: usar prices-lite como federado básico (rápido y sin puppeteer)
    const lite = await searchChainPricesLite(q, { lat, lng });
    const found = (lite.items || []).map(it => ({
      pharmacy: (it.chain || "").toLowerCase(), // "farmaexpress"
      name: it.name || "—",
      price: it.price ?? null,
      distance_km: it.nearest_km ?? null,
      maps_url: it.nearest_maps_url ?? null,
    }));

    // Rellenar otras cadenas visibles en Chile
    const want = ["ahumada","cruzverde","salcobrand","drsimi","farmaexpress"];
    const have = new Set(found.map(x=>x.pharmacy));
    const blanks = want
      .filter(p=>!have.has(p))
      .map(p=>({ pharmacy:p, name:`${p[0].toUpperCase()+p.slice(1)} — sin información`, price:null, distance_km:null, maps_url:null }));

    const results = [...found, ...blanks];

    res.json({ ok: true, q, count: results.length, items: results });
  } catch (err) {
    console.error("Error en /search", err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// -------------------- API oficial para la app (ENRIQUECIDA) --------------------
app.get("/api/prices", async (req, res) => {
  try {
    const qRaw = String(req.query.q || req.query.product || "").trim();
    if (!qRaw) return res.status(400).json({ ok:false, error:"q_required" });

    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;

    // 1) precios rápidos por cadena
    const lite = await searchChainPricesLite(qRaw, { lat, lng });
    const byChain = new Map(); // key: normalized chain -> { chainName, price, url, name }
    for (const it of (lite.items || [])) {
      const key = normBrand(it.chain);
      const prev = byChain.get(key);
      // nos quedamos con el mejor precio por cadena
      if (!prev || (Number.isFinite(it.price) && it.price < prev.price)) {
        byChain.set(key, {
          chainName: it.chain || "",
          price: Number.isFinite(it.price) ? it.price : null,
          buyUrl: it.url || null,
          // it.name puede venir, si no, ponemos qRaw
          productName: it.name || qRaw,
        });
      }
    }

    // 2) armar set de cadenas objetivo (incluye las grandes aunque no haya precio)
    const targetChains = new Set([
      ...byChain.keys(),
      normBrand("Ahumada"),
      normBrand("Cruz Verde"),
      normBrand("Salcobrand"),
      normBrand("Farmaexpress"),
      normBrand("Dr Simi"),
    ]);

    // 3) cargar sucursales y buscar la más cercana por cadena
    const stores = await loadStores(); // [{brand,name,lat,lng,address}, ...]
    const nearest = {}; // key normBrand -> { storeName, km, mapsUrl }

    if (lat != null && lng != null) {
      const user = { lat, lng };
      for (const key of targetChains) {
        // pool por marca
        const pool = stores.filter((s) => {
          const nb = normBrand(s.brand);
          return nb === key || nb.includes(key) || key.includes(nb);
        });
        if (!pool.length) continue;

        let best = null, bestKm = Infinity;
        for (const s of pool) {
          const km = kmBetween(user, { lat: s.lat, lng: s.lng });
          if (km < bestKm) { bestKm = km; best = s; }
        }
        if (best) {
          nearest[key] = {
            storeName: best.name,
            distanceKm: Math.round(bestKm * 10) / 10,
            mapsUrl: mapsUrlFor(best.lat, best.lng, `${best.name} ${best.address || ""}`.trim()),
          };
        }
      }
    }

    // 4) construir respuesta homogénea para la app
    const out = [];
    for (const key of targetChains) {
      const info = byChain.get(key) || { chainName: null, price: null, buyUrl: null, productName: qRaw };
      const chainName = info.chainName || (
        key === "ahumada" ? "Ahumada" :
        key === "cruzverde" ? "Cruz Verde" :
        key === "salcobrand" ? "Salcobrand" :
        key === "farmaexpress" ? "Farmaexpress" :
        key === "drsimi" ? "Dr. Simi" : "—"
      );

      const near = nearest[key] || null;
      out.push({
        // Campos que tu app ya consume:
        chainName,                           // ej. "Ahumada"
        price: info.price,                   // null si no hay
        inStock: true,                       // seguimos true para no romper color
        storeName: near?.storeName ?? null,  // ej. "Farmacias Ahumada - Av Vitacura 3619"
        distanceKm: near?.distanceKm ?? null,
        logoUrl: LOGOS[key] || null,
        buyUrl: info.buyUrl ? new URL(info.buyUrl).toString() : null,
        updatedAt: new Date().toISOString(),

        // Extra opcional (por si luego lo quieres usar):
        mapsUrl: near?.mapsUrl ?? null,
        productName: info.productName,
      });
    }

    // orden: con precio primero, luego menor distancia
    out.sort((a, b) => {
      if (a.price != null && b.price != null) return a.price - b.price;
      if (a.price != null) return -1;
      if (b.price != null) return 1;
      const da = a.distanceKm ?? Infinity, db = b.distanceKm ?? Infinity;
      return da - db;
    });

    res.json({
      ok: true,
      q: qRaw,
      count: out.length,
      items: out,
      lat, lng,
    });
  } catch (e) {
    console.error("Error /api/prices", e);
    res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
});

// -------------------- nearby (se mantiene) --------------------
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
      const nc = normBrand(chain);
      const pool = stores.filter((s) => {
        const nb = normBrand(s.brand);
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
        mapsUrl: mapsUrlFor(best.lat, best.lng, `${best.name} ${best.address}`),
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
