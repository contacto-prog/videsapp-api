// server.js – VIDESAPP API (precios + asistente MiPharmAPP)

import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import fs from "fs/promises";
import OpenAI from "openai";
import { searchChainPricesLite } from "./scrapers/chainsLite.js";

// ------------ Config básica ------------
const BUILD = "prices-lite-2025-11-26-assistant-v2";
const COMMIT = process.env.RENDER_GIT_COMMIT || null;
const PORT = process.env.PORT || 8080;

// Cliente OpenAI (asegúrate de tener OPENAI_API_KEY en Render)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(compression());
app.use(morgan("tiny"));
app.use(express.json()); // necesario para leer JSON del body

// Timeout defensivo
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
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sLat1 = Math.sin(dLat / 2),
    sLng1 = Math.sin(dLng / 2);
  const A =
    sLat1 * sLat1 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
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

function normalizePrice(p) {
  if (p == null) return null;
  const n = typeof p === "number" ? p : Number(p);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.round(n);
}

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

app.get("/api/ping", (_req, res) => {
  res.json({
    ok: true,
    service: "videsapp-api",
    endpoint: "/api/prices",
    build: BUILD,
    mode: "scrapers-v3",
    time: new Date().toISOString(),
  });
});

app.get("/prices-lite-ping", (_req, res) => {
  res.json({ ok: true, ping: "prices-lite", build: BUILD });
});

// -------------------- precios-lite (JSON de chainsLite) --------------------
app.get("/prices-lite", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    if (!q) return res.status(400).json({ ok: false, error: "q_required" });
    const data = await searchChainPricesLite(q, { lat, lng });
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Compat: /search2 -> precios-lite
app.get("/search2", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    if (!q) return res.status(400).json({ ok: false, error: "q_required" });
    const data = await searchChainPricesLite(q, { lat, lng });
    res.json({ ok: true, q, count: data.count, items: data.items });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
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

// -------------------- /api/prices (API oficial para la app) --------------------
app.get("/api/prices", async (req, res) => {
  const started = Date.now();
  console.log("[/api/prices] HIT", new Date().toISOString(), req.query);

  try {
    const q = String(req.query.q || req.query.product || "").trim();
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    const radiusMeters = req.query.radius ? Number(req.query.radius) : null;

    if (!q) {
      return res.status(400).json({ ok: false, error: "q_required" });
    }

    const chainsOrder = [
      "ahumada",
      "cruzverde",
      "drsimi",
      "salcobrand",
      "farmaexpress",
    ];
    const nowIso = new Date().toISOString();

    // Distancia máxima en km (radius en metros -> km; default 10, cap 50)
    let maxDistKm = 10;
    if (Number.isFinite(radiusMeters) && radiusMeters > 0) {
      maxDistKm = Math.min(radiusMeters / 1000, 50);
    }

    // 1) Cargar stores.json (para localizar sucursal cercana por cadena)
    let stores = [];
    const user =
      Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    const bestByChain = {};

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
    const scrapedByChain = {};
    try {
      const lite = await searchChainPricesLite(q, { lat, lng });
      for (const it of lite.items || []) {
        const rawChain = (it.chain || "").toString();
        const nc = norm(rawChain);

        for (const key of chainsOrder) {
          const meta = CHAIN_META[key];
          if (!meta) continue;
          const tk = norm(meta.chainName || key); // ej: "cruzverde"

          if (!nc.includes(tk) && !tk.includes(nc)) continue;

          const current = scrapedByChain[key];
          const candidatePrice = normalizePrice(it.price);
          const mapsFromItem = it.nearest_maps_url || it.mapsUrl || null;
          const urlFromItem = it.url || null;

          if (!current) {
            scrapedByChain[key] = {
              name: it.name || rawChain,
              price: candidatePrice,
              nearest_km: it.nearest_km ?? null,
              nearest_maps_url: mapsFromItem,
              url: urlFromItem,
            };
          } else {
            // Elegimos el precio más barato conocido
            const oldPrice = current.price;
            const better =
              candidatePrice != null &&
              (oldPrice == null || candidatePrice < oldPrice);
            if (better) {
              scrapedByChain[key] = {
                name: it.name || rawChain,
                price: candidatePrice,
                nearest_km: it.nearest_km ?? current.nearest_km ?? null,
                nearest_maps_url:
                  mapsFromItem ?? current.nearest_maps_url ?? null,
                url: urlFromItem ?? current.url ?? null,
              };
            }
          }
        }
      }
      console.log("[/api/prices] SCRAPED", scrapedByChain);
    } catch (e) {
      console.error(
        "Error en searchChainPricesLite dentro de /api/prices:",
        e
      );
    }

    // 3) Armar respuesta final por cadena
    const items = [];
    for (const key of chainsOrder) {
      const meta = CHAIN_META[key];
      if (!meta) continue;

      let storeName = null;
      let distanceKm = null;
      let mapsUrl = null;

      // info desde stores.json
      const best = bestByChain[key];
      if (best && best.store) {
        const s = best.store;
        storeName = s.name || s.brand || meta.chainName;
        distanceKm = Math.round(best.km * 10) / 10;
        mapsUrl = mapsLink(
          s.lat,
          s.lng,
          `${storeName} ${s.address || ""}`.trim()
        );
      }

      // info desde scrapers (si existe)
      const scraped = scrapedByChain[key];
      let price = null;
      let buyUrl = meta.searchUrl(q); // fallback

      if (scraped) {
        if (scraped.price != null && scraped.price > 0) {
          price = scraped.price;
        }
        if (scraped.name && !storeName) {
          storeName = scraped.name;
        }
        if (scraped.nearest_km != null && scraped.nearest_km > 0) {
          distanceKm = Math.round(scraped.nearest_km * 10) / 10;
        }
        if (scraped.nearest_maps_url) {
          mapsUrl = scraped.nearest_maps_url;
        }
        if (scraped.url) {
          buyUrl = scraped.url;
        }
      }

      items.push({
        chainName: meta.chainName,
        price, // null si no hay precio real
        inStock: price != null, // si hay precio, asumimos stock
        storeName,
        distanceKm,
        logoUrl: meta.logoUrl,
        buyUrl,
        updatedAt: nowIso,
        mapsUrl,
        productName: q,
      });
    }

    const elapsed = Date.now() - started;
    console.log("[/api/prices] DONE", elapsed + "ms", "items=" + items.length);

    res.json({
      ok: true,
      q,
      count: items.length,
      items,
      lat,
      lng,
      radiusMeters,
      maxDistKm,
      _query_used: q,
    });
  } catch (e) {
    const elapsed = Date.now() - started;
    console.error("[/api/prices] ERROR", elapsed + "ms", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// -------------------- nearby --------------------
app.get("/nearby", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!q) return res.status(400).json({ ok: false, error: "q_required" });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res
        .status(400)
        .json({ ok: false, error: "lat_lng_required" });
    }

    const prices = await searchChainPricesLite(q, { lat, lng });
    const stores = await loadStores();

    const user = { lat, lng };
    const rows = [];
    for (const it of prices.items || []) {
      const chain = it.chain || "";
      const nc = norm(chain);
      const pool = stores.filter((s) => {
        const nb = norm(s.brand);
        return nb.includes(nc) || nc.includes(nb);
      });
      if (!pool.length) continue;

      let best = null,
        bestKm = Infinity;
      for (const s of pool) {
        const km = kmBetween(user, { lat: s.lat, lng: s.lng });
        if (km < bestKm) {
          bestKm = km;
          best = s;
        }
      }
      if (!best) continue;

      rows.push({
        brand: chain,
        price: it.price ?? null,
        storeName: best.name,
        address: best.address,
        distance_km: Math.round(bestKm * 10) / 10,
        mapsUrl: mapsLink(
          best.lat,
          best.lng,
          `${best.name} ${best.address}`
        ),
        productUrl: it.url || null,
      });
    }

    rows.sort((a, b) => {
      if (a.price && b.price) return a.price - b.price;
      if (a.price) return -1;
      if (b.price) return 1;
      return a.distance_km - b.distance_km;
    });

    res.json({ ok: true, q, count: rows.length, items: rows });
  } catch (err) {
    res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
});

// -------------------- /api/chat (asistente MiPharmAPP) --------------------
app.post("/api/chat", async (req, res) => {
  try {
    const { message, pricesContext, productLabel } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "message_required" });
    }

    // Serializamos el contexto de precios en texto legible
    let pricesText = "";
    if (pricesContext && Array.isArray(pricesContext.items)) {
      const lines = pricesContext.items.map((it) => {
        const chainName = it.chainName || "Farmacia";
        const price =
          typeof it.price === "number" ? `$${it.price}` : "sin_precio";
        const dist =
          typeof it.distanceKm === "number"
            ? `${it.distanceKm.toFixed(1)} km`
            : "distancia_desconocida";
        const buyUrl = it.buyUrl || "sin_url";
        return `- ${chainName}: precio=${price}, distancia=${dist}, url=${buyUrl}`;
      });
      pricesText = lines.join("\n");
    }

    const systemPrompt = `
Eres el asistente de MiPharmAPP.

Tu objetivo es ayudar al usuario a decidir en qué farmacia le conviene comprar, usando SOLO la información que te entregamos.

REGLAS IMPORTANTES:
- NO inventes precios ni promociones. Si un precio viene como "sin_precio" o null, di explícitamente que el precio no está disponible.
- SI hay precios: compáralos y explica brevemente cuál parece más conveniente (por ejemplo la más barata, o la más barata dentro de cierta distancia).
- SI NO hay precios: 
  - Usa distancia ("km") y la presencia de links (url) para sugerir qué farmacia es más práctica (por ejemplo la más cercana o la que tiene sitio web directo).
  - Puedes decir que el usuario revise los botones de la app ("Ver en la web", "Ir") para detalles actualizados.
- No entregues indicaciones médicas personalizadas (dosificación, cambios de tratamiento, etc.). Siempre recomienda consultar a un profesional de la salud para eso.
- Responde SIEMPRE en español, en 3–6 frases máximo, fácil de leer dentro de una tarjeta de la app.
- No repitas literalmente todo el contexto, solo da un resumen útil.
`.trim();

    const userPrompt = `
Mensaje del usuario: "${message}"
Producto consultado: "${productLabel || ""}"

Resultados de farmacias (uno por línea, ya normalizados):
${pricesText || "(sin datos de precios, solo listado de farmacias)"}

Da una recomendación corta sobre qué farmacia podría convenir más, respetando las reglas.
`.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 220,
      temperature: 0.4,
    });

    const answer = completion.choices?.[0]?.message?.content || "";

    res.json({
      ok: true,
      answer,
    });
  } catch (e) {
    console.error("Error en /api/chat", e);
    res.status(500).json({ ok: false, error: "openai_error" });
  }
});

// -------------------- 404 --------------------
app.use((req, res) =>
  res.status(404).json({ ok: false, error: "not_found", path: req.path })
);

// -------------------- start & shutdown --------------------
const server = app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Server listening on http://0.0.0.0:${PORT}`, {
    BUILD,
    COMMIT,
  })
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
