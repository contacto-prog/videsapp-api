// scrapers/searchFederated.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scrapePrices } from "./index.js"; // <-- usa tu agregador actual

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORES_FILE = path.join(__dirname, "..", "data", "stores.json");

// Haversine en km
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
    branches = all.filter(x => (x.store || "").toLowerCase() === String(storeName).toLowerCase());
  } catch { /* sin archivo o sin sucursales */ }

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

// Normaliza un item de tu agregador a la forma final
function normalizeItem(it) {
  if (!it) return null;
  const store = it.source || it.store || "";
  const name = (it.name || "").toString().trim();
  const price = Number(it.price);
  const url = it.url || null;
  const available = (typeof it.available === "boolean") ? it.available : true;
  if (!store || !name || !Number.isFinite(price)) return null;
  return { store, name, price, currency: it.currency || "CLP", url, available, sku: it.sku || null };
}

// Top-1 por tienda desde un array de items normalizados
function pickTop1PerStore(items) {
  const byStore = new Map();
  for (const it of items) {
    const key = it.store.toLowerCase();
    const current = byStore.get(key);
    if (!current || it.price < current.price) byStore.set(key, it);
  }
  return Array.from(byStore.values());
}

// ---------- API principal que usa el server ----------
export async function federatedSearchTop1(query, { limitPerStore = 10, lat = null, lng = null, debug = false } = {}) {
  if (!query || !query.trim()) {
    return { ok: false, count: 0, items: [], errors: ["missing_query"] };
  }

  // 1) Usa tu agregador (ya maneja timeouts, reintentos y Puppeteer compartido)
  let agg;
  try {
    agg = await scrapePrices(query);
  } catch (err) {
    return { ok: false, count: 0, items: [], errors: [String(err?.message || err)] };
  }

  // 2) Normaliza items y toma top-1 por tienda
  const normalized = (agg.items || []).map(normalizeItem).filter(Boolean).filter(x => x.available !== false);
  let picked = pickTop1PerStore(normalized);

  // 3) Adjunta sucursal más cercana (si hay lat/lng)
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    picked = picked.map(p => ({ ...p, nearest: nearestBranch(p.store, lat, lng) }));
  }

  // 4) Orden final por precio ascendente y limita (por prolijidad)
  picked.sort((a, b) => a.price - b.price);
  if (limitPerStore && Number.isFinite(limitPerStore)) {
    // limitPerStore se aplica al total final solo para acotar payload
    picked = picked.slice(0, Math.max(1, limitPerStore));
  }

  const payload = { ok: true, q: query, count: picked.length, items: picked };
  if (debug) {
    payload.debug = {
      sourcesTried: agg.sources || [],
      scraperErrors: agg.errors || [],
      sample: normalized.slice(0, 3)
    };
  }
  return payload;
}
