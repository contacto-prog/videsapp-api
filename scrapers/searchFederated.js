// scrapers/searchFederated.js (REEMPLAZA TODO EL ARCHIVO)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Importa los scrapers por tienda (usa los que ya tienes en /scrapers)
import { searchAhumada } from "./ahumada.js";
import { searchDrSimi } from "./drsimi.js";
import { searchCruzVerde } from "./cruzverde.js";      // usa Puppeteer internamente (tu archivo)
import { searchSalcobrand } from "./salcobrand.js";    // fetch/puppeteer según tu implementación
import { searchFarmaexpress } from "./farmaexpress.js";// usa Puppeteer (farmex.cl)

// -------------------- Utilidades --------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORES_FILE = path.join(__dirname, "..", "data", "stores.json");

// Haversine: distancia en km
function distanceKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180;
  const la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function nearestBranch(storeName, userLat, userLng) {
  if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) return null;
  let branches = [];
  try {
    const raw = fs.readFileSync(STORES_FILE, "utf8");
    const all = JSON.parse(raw);
    branches = all.filter(x => (x.store || "").toLowerCase() === storeName.toLowerCase());
  } catch { /* sin sucursales */ }

  if (!branches.length) return null;
  const me = { lat: userLat, lng: userLng };
  let best = null;
  for (const b of branches) {
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) continue;
    const d = distanceKm(me, { lat: b.lat, lng: b.lng });
    if (!best || d < best.distance_km) best = { ...b, distance_km: Math.round(d * 10) / 10 };
  }
  if (!best) return null;
  const maps = `https://www.google.com/maps/dir/${userLat},${userLng}/${encodeURIComponent(best.address || `${best.lat},${best.lng}`)}`;
  return { name: best.name, address: best.address, lat: best.lat, lng: best.lng, distance_km: best.distance_km, maps_url: maps };
}

// Normaliza un item de cualquier scraper
function normalizeItem(store, it) {
  if (!it) return null;
  const name = (it.name || "").toString().trim();
  const price = Number(it.price);
  const url = it.url || null;
  const available = (typeof it.available === "boolean") ? it.available : true;
  if (!name || !Number.isFinite(price)) return null;
  return { store, name, price, currency: it.currency || "CLP", url, available };
}

// Corre un scraper con límite y manejo de errores
async function runStore(label, fn, query, limit, debug) {
  const result = { store: label, ok: false, items: [], error: null, picked: null, debug: null };
  try {
    const items = await fn(query, { limit, debug });
    const arr = Array.isArray(items?.items) ? items.items : Array.isArray(items) ? items : [];
    const norm = arr.map(x => normalizeItem(label, x)).filter(Boolean);
    // elige el más barato disponible
    const sorted = norm.filter(x => x.available !== false).sort((a, b) => a.price - b.price);
    result.items = sorted.slice(0, limit);
    result.picked = sorted[0] || null;
    result.ok = true;
    if (debug && items?.debug) result.debug = items.debug;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
  return result;
}

// -------------------- Orquestador Principal --------------------
export async function federatedSearchTop1(query, { limitPerStore = 10, lat = null, lng = null, debug = false } = {}) {
  if (!query || !query.trim()) {
    return { ok: false, count: 0, items: [], errors: ["missing_query"] };
  }

  // Define el “pool” de tiendas a consultar
  const tasks = [
    runStore("Ahumada",      searchAhumada,     query, limitPerStore, debug),
    runStore("Cruz Verde",   searchCruzVerde,   query, limitPerStore, debug),
    runStore("Salcobrand",   searchSalcobrand,  query, limitPerStore, debug),
    runStore("Dr. Simi",     searchDrSimi,      query, limitPerStore, debug),
    runStore("Farmaexpress", searchFarmaexpress,query, limitPerStore, debug),
  ];

  const results = await Promise.all(tasks);

  // Toma “top-1” por tienda (si existe)
  let picked = results.map(r => r.picked ? { ...r.picked } : null).filter(Boolean);

  // Adjunta sucursal más cercana si hay lat/lng
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    picked = picked.map(p => ({
      ...p,
      nearest: nearestBranch(p.store, lat, lng)
    }));
  }

  // Orden final por precio ascendente
  picked.sort((a, b) => a.price - b.price);

  const payload = {
    ok: true,
    q: query,
    count: picked.length,
    items: picked
  };

  if (debug) {
    payload.debug = {
      perStore: results.map(r => ({
        store: r.store,
        ok: r.ok,
        error: r.error,
        sample: r.items?.[0] || null,
        picked: r.picked,
        extra: r.debug || null
      }))
    };
  }

  return payload;
}
