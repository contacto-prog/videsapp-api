// scrapers/chainsLite.js — v3 (Google lite + fallback directo para Dr. Simi)
import { searchDrSimi } from "./drsimi.js";

const HOST_TO_CHAIN = {
  "cruzverde.cl": "Cruz Verde",
  "www.cruzverde.cl": "Cruz Verde",
  "farmaciasahumada.cl": "Ahumada",
  "www.farmaciasahumada.cl": "Ahumada",
  "salcobrand.cl": "Salcobrand",
  "www.salcobrand.cl": "Salcobrand",
  "farmex.cl": "Farmaexpress",
  "www.farmex.cl": "Farmaexpress",
  "drsimi.cl": "Dr. Simi",
  "www.drsimi.cl": "Dr. Simi",
  "cofar.cl": "Cofar",
  "www.cofar.cl": "Cofar",
  "ecofarmacias.cl": "EcoFarmacias",
  "www.ecofarmacias.cl": "EcoFarmacias",
  "novasalud.cl": "Novasalud",
  "www.novasalud.cl": "Novasalud",
  "recetasolidaria.cl": "Receta Solidaria",
  "www.recetasolidaria.cl": "Receta Solidaria",
};

function parsePrice(s) {
  if (!s) return null;
  // Normaliza NBSP
  const m = s.replace(/\u00A0/g, " ").match(/(?:CLP\s*)?\$?\s*([\d\.]{3,})/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n < 200 || n > 1000000) return null;
  return n;
}

function mkMapsUrl(chain, lat = null, lng = null) {
  const base = "https://www.google.com/maps/dir/?api=1";
  const dest = encodeURIComponent("Farmacia " + chain);
  if (lat != null && lng != null)
    return `${base}&destination=${dest}&origin=${lat},${lng}&travelmode=driving`;
  return `${base}&destination=${dest}&travelmode=driving`;
}

async function fetchWithTimeout(url, { timeoutMs = 8000, headers = {} } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ac.signal });
    const txt = await res.text();
    return txt;
  } finally {
    clearTimeout(t);
  }
}

function* windowed(arr, w) {
  for (let i = 0; i < arr.length; i++) {
    const start = Math.max(0, i - w),
      end = Math.min(arr.length, i + w + 1);
    yield arr.slice(start, end).join(" ");
  }
}

export async function searchChainPricesLite(q, { lat = null, lng = null } = {}) {
  const start = Date.now();
  const HARD_LIMIT_MS = 12000;

  // Google (vía r.jina.ai) restringido por dominio
  const query =
    q +
    " precio (site:cruzverde.cl OR site:farmaciasahumada.cl OR site:salcobrand.cl OR site:farmex.cl OR site:drsimi.cl)";
  const url = `https://r.jina.ai/http://www.google.com/search?q=${encodeURIComponent(
    query
  )}&hl=es-CL&num=30`;

  let text = "";
  try {
    text = await fetchWithTimeout(url, {
      timeoutMs: 9000,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
      },
    });
  } catch (e) {
    // Fallará el Google-lite, seguimos con fallback simi
    text = "";
  }

  if (Date.now() - start > HARD_LIMIT_MS) {
    return { ok: true, query: q, count: 0, items: [], note: "hard_limit_exceeded" };
  }

  // Parseo heurístico del HTML simplificado de r.jina.ai
  const lines = (text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const items = [];
  for (const chunk of windowed(lines, 3)) {
    const urls = [...chunk.matchAll(/https?:\/\/[^\s\)\]]+/g)].map((m) => m[0]);
    if (!urls.length) continue;
    const price = parsePrice(chunk);
    if (!price) continue;
    for (const u of urls) {
      let host = "";
      try {
        host = new URL(u).host.replace(/^www\./, "");
      } catch {}
      const chain = HOST_TO_CHAIN[host] || HOST_TO_CHAIN["www." + host];
      if (!chain) continue;

      items.push({
        chain,
        price,
        url: u,
        mapsUrl: mkMapsUrl(chain, lat, lng),
        // name opcional: Google no da nombre consistente; lo dejamos vacío
        name: null,
      });
    }
  }

  // Dedup: mejor precio por cadena
  const byChain = new Map();
  for (const it of items) {
    const prev = byChain.get(it.chain);
    if (!prev || it.price < prev.price) byChain.set(it.chain, it);
  }
  let uniq = Array.from(byChain.values()).sort((a, b) => a.price - b.price);

  // -------- Fallback específico: Dr. Simi directo --------
  const hasSimi = uniq.some((x) => x.chain === "Dr. Simi");
  if (!hasSimi) {
    try {
      const simiItems = await searchDrSimi(q); // [{chain:'drsimi', name, price, url}]
      const withPrice = (simiItems || []).filter(
        (x) => Number.isFinite(x?.price) && x.price > 0
      );
      if (withPrice.length) {
        // Elegimos el más barato
        withPrice.sort((a, b) => a.price - b.price);
        const best = withPrice[0];
        uniq.push({
          chain: "Dr. Simi",
          price: best.price,
          url: best.url || "https://www.drsimi.cl/",
          mapsUrl: mkMapsUrl("Dr. Simi", lat, lng),
          name: best.name || null,
        });
        // Ordenar nuevamente por precio
        uniq.sort((a, b) => a.price - b.price);
      }
    } catch {
      // si falla, seguimos sin Simi
    }
  }

  return {
    ok: true,
    query: q,
    count: uniq.length,
    items: uniq.slice(0, 8),
    took_ms: Date.now() - start,
  };
}
