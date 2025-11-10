// server.js – VIDESAPP API (prices-lite + federado + nearby)
import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import fs from "fs/promises";
import { searchChainPricesLite } from "./scrapers/chainsLite.js";

const BUILD  = "prices-lite-2025-11-10-hotfix2";
const COMMIT = process.env.RENDER_GIT_COMMIT || null;
const PORT   = process.env.PORT || 8080;

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(compression());
app.use(morgan("tiny"));

// Timeout defensivo (respuesta 504 si algo se cuelga)
app.use((req, res, next) => {
  res.setTimeout(15000, () => {
    try { res.status(504).json({ ok:false, error:"gateway_timeout" }); } catch {}
  });
  next();
});

/* -------------------- Helpers -------------------- */
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
const normBrand = (s) =>
  (s || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, "").replace(/farmacia(s)?/g, "");

/** Normaliza la query para mejorar el hit-rate en tiendas.
 *  - baja a minúsculas
 *  - quita acentos
 *  - elimina concentraciones (mg, ml, mcg, %, etc.) y “x 16”, “20 comp”, etc.
 *  - se queda con 1–2 primeras palabras
 */
function normalizeQuery(qRaw) {
  let t = String(qRaw || "").toLowerCase().trim();
  t = t.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  t = t.replace(/\b\d+[.,]?\d*\s*(mg|ml|mcg|µg|ug|g|gr|%)\b/gi, " ");
  t = t.replace(/\bx\s*\d+\b/gi, " ");
  t = t.replace(/\b\d+\s*(comp|caps|capsulas?|tabletas?)\b/gi, " ");
  t = t.replace(/[-_/.,;:(){}\[\]]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  const parts = t.split(" ").filter(Boolean);
  if (parts.length === 0) return qRaw.toString().trim();
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1]}`;
}

/** Busca con query normalizada; si no encuentra y la normalizada difiere, reintenta con la original. */
async function searchLiteSmart(qRaw, { lat = null, lng = null } = {}) {
  const qNorm = normalizeQuery(qRaw);
  let data = await searchChainPricesLite(qNorm, { lat, lng }).catch(() => ({ count: 0, items: [] }));
  if ((data?.count || 0) === 0 && qNorm !== qRaw) {
    data = await searchChainPricesLite(qRaw, { lat, lng }).catch(() => ({ count: 0, items: [] }));
  }
  // adjuntamos qué query se usó (útil para logs)
  return { ...(data || { count:0, items:[] }), _query_used: (data?.count ? qNorm : qRaw) };
}

/* -------------------- Health -------------------- */
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

/* -------------------- precios-lite (JSON nativo de chainsLite) -------------------- */
app.get("/prices-lite", async (req, res) => {
  try {
    const qRaw = String(req.query.q || "").trim();
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    if (!qRaw) return res.status(400).json({ ok:false, error:"q_required" });

    const data = await searchLiteSmart(qRaw, { lat, lng });
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok:false, error:String(err?.message || err) });
  }
});

/* -------------------- Compat: /search2 -> precios-lite (reducido) -------------------- */
app.get("/search2", async (req, res) => {
  try {
    const qRaw = String(req.query.q || "").trim();
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    if (!qRaw) return res.status(400).json({ ok:false, error:"q_required" });

    const data = await searchLiteSmart(qRaw, { lat, lng });
    res.json({ ok:true, q: qRaw, count: data.count, items: data.items });
  } catch (err) {
    res.status(500).json({ ok:false, error:String(err?.message || err) });
  }
});

/* -------------------- federado (Top-1 por cadena) -------------------- */
// Intenta fetchFederated.js; si falla, hace fallback a prices-lite + placeholders
app.get("/search", async (req, res) => {
  try {
    const qRaw = String(req.query.q || "").trim();
    if (!qRaw) return res.status(400).json({ ok: false, error: "q_required" });

    const lat = Number(req.query.lat || process.env.GEO_LAT || -33.4489);
    const lng = Number(req.query.lng || process.env.GEO_LNG || -70.6693);
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY || "";

    let results = null;
    try {
      const { searchFederated } = await import("./fetchFederated.js");
      // pasamos la query normalizada para mejorar el % de acierto
      const q = normalizeQuery(qRaw);
      results = await searchFederated({ q, lat, lng, mapsKey });
    } catch (_e) {
      // Fallback: usamos prices-lite inteligente y rellenamos otras cadenas “sin información”
      const lite = await searchLiteSmart(qRaw, { lat, lng });
      const found = (lite.items || []).map(it => ({
        pharmacy: (it.chain || "").toLowerCase(), // ej. farmaexpress
        name: it.name || "—",
        price: it.price ?? null,
        distance_km: it.nearest_km ?? null,
        maps_url: it.nearest_maps_url ?? null,
      }));
      const want = ["ahumada","cruzverde","salcobrand","drsimi","farmaexpress"];
      const have = new Set(found.map(x=>x.pharmacy));
      const blanks = want
        .filter(p=>!have.has(p))
        .map(p=>({
          pharmacy:p,
          name: (p.charAt(0).toUpperCase()+p.slice(1)) + " — sin información",
          price:null,
          distance_km:null,
          maps_url:null
        }));
      results = [...found, ...blanks];
    }

    res.json({ ok: true, q: qRaw, count: results.length, items: results });
  } catch (err) {
    console.error("Error en /search", err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

/* -------------------- API oficial esperada por la app -------------------- */
// HOTFIX: usa prices-lite inteligente (sin Puppeteer) y acepta q= o product=
app.get("/api/prices", async (req, res) => {
  try {
    const qRaw = String(req.query.q || req.query.product || "").trim();
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;

    if (!qRaw) return res.status(400).json({ ok:false, error:"q_required" });

    const data = await searchLiteSmart(qRaw, { lat, lng });

    // Adaptamos al formato que tu app ya consume: store/name/price/url/stock
    const items = (data.items || []).map(r => ({
      store: (r.chain || "").replace(/\b\w/g, c => c.toUpperCase()), // "Farmaexpress"
      name:  r.name || "—",
      price: r.price ?? null,
      url:   r.url || null,
      stock: true, // por defecto true (no rompemos el orden/colores)
    }));

    res.json({
      ok: true,
      q: qRaw,
      count: items.length,
      items,
      lat, lng,
      _query_used: data._query_used || null
    });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
});

/* -------------------- nearby -------------------- */
app.get("/nearby", async (req, res) => {
  try {
    const qRaw = String(req.query.q || "").trim();
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!qRaw)  return res.status(400).json({ ok:false, error:"q_required" });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok:false, error:"lat_lng_required" });
    }

    const prices = await searchLiteSmart(qRaw, { lat, lng });
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

    res.json({ ok:true, q: qRaw, count: rows.length, items: rows });
  } catch (err) {
    res.status(500).json({ ok:false, error:String(err?.message || err) });
  }
});

/* -------------------- 404 -------------------- */
app.use((req, res) =>
  res.status(404).json({ ok:false, error:"not_found", path: req.path })
);

/* -------------------- start & shutdown -------------------- */
const server = app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Server listening on http://0.0.0.0:${PORT}`, { BUILD, COMMIT })
);
// sube el timeout a 30s (útil en Render cold start)
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
