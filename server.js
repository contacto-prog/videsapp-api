// server.js – VIDESAPP API (prices-lite + federado + nearby + prices API MVP)
import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import fs from "fs/promises";
import { searchChainPricesLite } from "./scrapers/chainsLite.js";

const BUILD  = "prices-lite-2025-11-14-scrapers";
const COMMIT = process.env.RENDER_GIT_COMMIT || null;
const PORT   = process.env.PORT || 8080;

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(compression());
app.use(morgan("tiny"));

// Timeout defensivo (respuesta 504 si algo se cuelga)
app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    try {
      console.error("[TIMEOUT] Respuesta 504 por timeout de request");
      res.status(504).json({ ok: false, error: "gateway_timeout" });
    } catch {}
  });
  next();
});

// -------------------- Helpers --------------------
function kmBetween(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sLat1 = Math.sin(dLat / 2), sLng1 = Math.sin(dLng / 2);
  const A =
    sLat1 * sLat1 +
    Math.cos(a.lat * Math.PI / 180) *
      Math.cos(b.lat * Math.PI / 180) *
      sLng1 * sLng1;
  return 2 * R * Math.asin(Math.sqrt(A));
}

function mapsLink(lat, lng, label) {
  const q = encodeURIComponent(label || "");
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_name=${q}`;
}

async function loadStores() {
  const raw = await fs.readFile(
    new URL("./data/stores.json", import.meta.url),
    "utf-8"
  );
  return JSON.parse(raw);
}

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, "")
    .replace(/farmacia(s)?/g, "");

// metadatos de cadenas para logos y links de búsqueda
const CHAIN_META = {
  ahumada: {
    key: "ahumada",
    chainName: "Ahumada",
    logoUrl: "https://static-videsapp.s3.amazonaws.com/logos/ahumada.png",
    searchUrl: (q) =>
      `https://www.farmaciasahumada.cl/search?q=${encodeURIComponent(q)}`,
  },
  cruzverde: {
    key: "cruzverde",
    chainName: "Cruz Verde",
    logoUrl: "https://static-videsapp.s3.amazonaws.com/logos/cruzverde.png",
    searchUrl: (q) =>
      `https://www.cruzverde.cl/search?q=${encodeURIComponent(q)}`,
  },
  salcobrand: {
    key: "salcobrand",
    chainName: "Salcobrand",
    logoUrl: "https://static-videsapp.s3.amazonaws.com/logos/salcobrand.png",
    searchUrl: (q) =>
      `https://www.salcobrand.cl/search?text=${encodeURIComponent(q)}`,
  },
  drsimi: {
    key: "drsimi",
    chainName: "Dr. Simi",
    logoUrl: "https://static-videsapp.s3.amazonaws.com/logos/drsimi.png",
    searchUrl: (q) =>
      `https://www.google.com/search?q=${encodeURIComponent(
        `site:drsimi.cl ${q}`
      )}`,
  },
  farmaexpress: {
    key: "farmaexpress",
    chainName: "Farmaexpress",
    logoUrl: "https://static-videsapp.s3.amazonaws.com/logos/farmaexpress.png",
    searchUrl: (q) => `https://farmex.cl/search?q=${encodeURIComponent(q)}`,
  },
};

// -------------------- Health --------------------
app.get("/", (_req, res) =>
  res.type("text/plain").send("VIDESAPP API – OK")
);

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

// Ping específico para la app Flutter
app.get("/api/ping", (_req, res) => {
  res.json({
    ok: true,
    service: "videsapp-api",
    endpoint: "/api/prices",
    build: BUILD,
    mode: "scrapers-v1",
    time: new Date().toISOString(),
  });
});

app.get("/prices-lite-ping", (_req, res) => {
  res.json({ ok: true, ping: "prices-lite", build: BUILD });
});

// -------------------- precios-lite (JSON nativo de chainsLite) --------------------
app.get("/prices-lite", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    if (!q) return res.status(400).json({ ok: false, error: "q_required" });
    const data = await searchChainPricesLite(q, { lat, lng });
    res.json(data);
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
});

// Compat: /search2 -> precios-lite (mismo formato reducido)
app.get("/search2", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    if (!q) return res.status(400).json({ ok: false, error: "q_required" });
    const data = await searchChainPricesLite(q, { lat, lng });
    res.json({ ok: true, q, count: data.count, items: data.items });
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
});

// -------------------- federado (Top-1 por cadena) --------------------
app.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ ok: false, error: "q_required" });

    const lat = Number(req.query.lat || process.env.GEO_LAT || -33.4489);
    const lng = Number(req.query.lng || process.env.GEO_LNG || -70.6693);
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY || "";

    let results = null;
    try {
      const { searchFederated } = await import("./fetchFederated.js");
      results = await searchFederated({ q, lat, lng, mapsKey });
    } catch (_e) {
      const lite = await searchChainPricesLite(q, { lat, lng });
      const found = (lite.items || []).map((it) => ({
        pharmacy: (it.chain || "").toLowerCase(),
        name: it.name || "—",
        price: it.price ?? null,
        distance_km: it.nearest_km ?? null,
        maps_url: it.nearest_maps_url ?? null,
      }));
      const want = [
        "ahumada",
        "cruzverde",
        "salcobrand",
        "drsimi",
        "farmaexpress",
      ];
      const have = new Set(found.map((x) => x.pharmacy));
      const blanks = want
        .filter((p) => !have.has(p))
        .map((p) => ({
          pharmacy: p,
          name:
            p.charAt(0).toUpperCase() + p.slice(1) + " — sin información",
          price: null,
          distance_km: null,
          maps_url: null,
        }));
      results = [...found, ...blanks];
    }

    res.json({
      ok: true,
      q,
      count: results.length,
      items: results,
    });
  } catch (err) {
    console.error("Error en /search", err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// -------------------- API oficial esperada por la app --------------------
// Usa scrapers (searchChainPricesLite) para obtener precios reales por cadena.
// Si no hay precio para una cadena, igual la mostramos con logo + link de búsqueda.
app.get("/api/prices", async (req, res) => {
  const started = Date.now();
  console.log("[/api/prices] HIT", new Date().toISOString(), req.query);

  try {
    const q = String(req.query.q || req.query.product || "").trim();
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    const radiusMeters = req.query.radius
      ? Number(req.query.radius)
      : null;

    if (!q) return res.status(400).json({ ok: false, error: "q_required" });

    const chainsOrder = [
      "ahumada",
      "cruzverde",
      "drsimi",
      "salcobrand",
      "farmaexpress",
    ];
    const nowIso = new Date().toISOString();

    // Distancia máxima en km (si envías radius en metros, lo usamos; si no, 10km por defecto)
    let maxDistKm = 10;
    if (Number.isFinite(radiusMeters) && radiusMeters > 0) {
      maxDistKm = Math.min(radiusMeters / 1000, 50);
    }

    // 1) Cargar stores.json (para fallback de distancia/sucursal)
    let stores = [];
    let bestByChain = {};
    const user =
      Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

    if (user) {
      try {
        stores = await loadStores();
      } catch (e) {
        console.error("No se pudo cargar stores.json:", e);
      }
    }

    if (user && Array.isArray(stores) && stores.length) {
      for (const s of stores) {
        if (typeof s.lat !== "number" || typeof s.lng !== "number") continue;

        const km = kmBetween(user, { lat: s.lat, lng: s.lng });
        if (!Number.isFinite(km)) continue;
        if (km > maxDistKm) continue;

        const brand = s.brand || "";
        const nb = norm(brand);

        for (const key of chainsOrder) {
          const meta = CHAIN_META[key];
          if (!meta) continue;
          const targetKey = norm(meta.chainName || key);

          if (!nb.includes(targetKey) && !targetKey.includes(nb)) continue;

          const current = bestByChain[key];
          if (!current || km < current.km) {
            bestByChain[key] = { store: s, km };
          }
        }
      }
    }

    // 2) Llamar a scrapers (prices-lite) para obtener precios reales
    let scrapedByChain = {};
    try {
      const lite = await searchChainPricesLite(q, { lat, lng });
      for (const it of lite.items || []) {
        const rawChain = (it.chain || "").toString();
        const nc = norm(rawChain);

        for (const key of chainsOrder) {
          const meta = CHAIN_META[key];
          if (!meta) continue;
          const tk = norm(meta.chainName || key);

          if (!nc.includes(tk) && !tk.includes(nc)) continue;

          const current = scrapedByChain[key];
          const candidatePrice =
            typeof it.price === "number" ? it.price : Number(it.price) || null;

          if (!current) {
            scrapedByChain[key] = {
              name: it.name || rawChain,
              price: candidatePrice,
              nearest_km: it.nearest_km ?? null,
              nearest_maps_url: it.near
