import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scrapePrices } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORES_FILE = path.join(__dirname, "..", "data", "stores.json");

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
  } catch {}
  if (!branches.length) return null;
  const me = { lat: userLat, lng: userLng };
  let best = null;
  for (const b of branches) {
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) continue;
    const d = distanceKm(me, { lat: b.lat, lng: b.lng });
    if (!best || d < best.distance_km) best = { ...b, distance_km: Math.round(d * 10) / 10 };
  }
  if (!best) return null;
  const maps = \`https://www.google.com/maps/dir/\${userLat},\${userLng}/\${encodeURIComponent(best.address || \`\${best.lat},\${best.lng}\`)}\`;
  return { name: best.name, address: best.address, lat: best.lat, lng: best.lng, distance_km: best.distance_km, maps_url: maps };
}

function normalizeItem(it) {
  if (!it) return null;
  const pharmacy = it.source || it.store || "";
  const product_name = String(it.name || "").trim();
  const priceNum = Number(it.price);
  if (!pharmacy || !product_name || !Number.isFinite(priceNum)) return null;
  const price = Math.max(0, Math.round(priceNum));
  const stock = (typeof it.available === "boolean") ? (it.available ? "available" : "out") : "unknown";
  return {
    pharmacy,
    product_name,
    presentation: String(it.presentation || "").trim(),
    price,
    stock,
    url: it.url || null,
    fetched_at: new Date().toISOString(),
    sku: it.sku || null
  };
}

function pickTop1PerStore(items) {
  const by = new Map();
  for (const it of items) {
    const key = it.pharmacy.toLowerCase();
    const cur = by.get(key);
    if (!cur || it.price < cur.price) by.set(key, it);
  }
  return Array.from(by.values());
}

export async function federatedSearchTop1(q, ctx = {}) {
  let query = "";
  let lat = null, lng = null, limitPerStore = 10;
  if (typeof q === "string") {
    query = q.trim();
  } else if (q && typeof q === "object") {
    query = String(q.name ?? q.q ?? "").trim();
    lat = Number.isFinite(q.lat) ? q.lat : null;
    lng = Number.isFinite(q.lng) ? q.lng : null;
    if (Number.isFinite(q.limitPerStore)) limitPerStore = q.limitPerStore;
  }
  if (Number.isFinite(ctx.lat)) lat = ctx.lat;
  if (Number.isFinite(ctx.lng)) lng = ctx.lng;
  if (Number.isFinite(ctx.limitPerStore)) limitPerStore = ctx.limitPerStore;

  if (!query) return [];

  let agg;
  try {
    agg = await scrapePrices(query);
  } catch (err) {
    if (ctx.logger?.error) ctx.logger.error(\`federated: scrapePrices error: \${err?.message || err}\`);
    return [];
  }

  const normalized = (agg?.items ?? [])
    .map(normalizeItem)
    .filter(Boolean)
    .filter(x => x.stock !== "out");

  let picked = pickTop1PerStore(normalized);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    picked = picked.map(p => ({ ...p, nearest: nearestBranch(p.pharmacy, lat, lng) }));
  }

  picked.sort((a, b) => a.price - b.price);
  if (Number.isFinite(limitPerStore) && limitPerStore > 0) {
    picked = picked.slice(0, limitPerStore);
  }

  return picked;
}

export default { federatedSearchTop1 };
