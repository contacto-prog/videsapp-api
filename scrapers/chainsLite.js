// scrapers/chainsLite.js
// 👉 Nueva versión: usa scrapers Puppeteer en vez de Google + Jina

import puppeteer from "puppeteer";

import { fetchAhumada, sourceId as ahumadaId } from "./ahumada.js";
import { fetchCruzVerde, sourceId as cruzVerdeId } from "./cruzverde.js";
import { fetchSalcobrand, sourceId as salcobrandId } from "./salcobrand.js";
import { fetchDrSimi, sourceId as drsimiId } from "./drsimi.js";
import {
  fetchFarmaexpress,
  sourceId as farmaexpressId,
} from "./farmaexpress.js";

// Si alguno de estos archivos todavía no expone `fetchXXX` y `sourceId`,
// solo tienes que seguir el mismo patrón que en ahumada.js.

const SOURCES = [
  { id: ahumadaId, label: "Ahumada", fetcher: fetchAhumada },
  { id: cruzVerdeId, label: "Cruz Verde", fetcher: fetchCruzVerde },
  { id: salcobrandId, label: "Salcobrand", fetcher: fetchSalcobrand },
  { id: drsimiId, label: "Dr. Simi", fetcher: fetchDrSimi },
  { id: farmaexpressId, label: "Farmaexpress", fetcher: fetchFarmaexpress },
];

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), ms);
    promise
      .then((res) => {
        clearTimeout(id);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(id);
        reject(err);
      });
  });
}

/**
 * Búsqueda federada: consulta todas las cadenas con scrapers reales.
 * Mantiene la misma firma que la versión anterior para no romper server.js.
 *
 * Devuelve:
 *   { ok, query, count, items: [{ chain, name, price, url }] }
 */
export async function searchChainPricesLite(
  q,
  { lat = null, lng = null } = {}
) {
  const started = Date.now();
  const HARD_LIMIT_MS = 12000;

  if (!q || !q.trim()) {
    return { ok: false, error: "q_required", query: q, count: 0, items: [] };
  }

  const query = q.trim();

  try {
    const perSource = await Promise.all(
      SOURCES.map(async (src) => {
        try {
          const rows = await withTimeout(
            src.fetcher(query, {
              puppeteer,
              headless: "new",
              executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            }),
            9000
          );

          return rows.map((r) => ({
            chain: src.label,            // "Ahumada", "Cruz Verde", etc.
            name: r.name || query,
            price: r.price ?? null,
            url: r.url || null,
            // mapsUrl / nearest_km no se calculan aquí; server.js usa stores.json
          }));
        } catch (e) {
          if (process.env.DEBUG_PRICES) {
            console.error(`[chainsLite] Error en scraper ${src.id}:`, e);
          }
          return [];
        }
      })
    );

    const flat = perSource.flat();

    if (Date.now() - started > HARD_LIMIT_MS) {
      return {
        ok: true,
        query,
        count: 0,
        items: [],
        note: "hard_limit_exceeded",
      };
    }

    // Elegir mejor precio por cadena
    const byChain = new Map();
    for (const it of flat) {
      if (it.price == null || !Number.isFinite(it.price)) continue;
      const prev = byChain.get(it.chain);
      if (!prev || it.price < prev.price) {
        byChain.set(it.chain, it);
      }
    }

    const uniq = Array.from(byChain.values()).sort(
      (a, b) => a.price - b.price
    );

    return {
      ok: true,
      query,
      count: uniq.length,
      items: uniq,
      took_ms: Date.now() - started,
    };
  } catch (e) {
    if (process.env.DEBUG_PRICES) {
      console.error("[chainsLite] Error general:", e);
    }
    return {
      ok: false,
      error: String(e?.message || e),
      query,
      count: 0,
      items: [],
    };
  }
}
