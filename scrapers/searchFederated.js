import { scrapePrices } from "./index.js";

function keyOf(q){
  if (typeof q === "string") return q.trim();
  if (q && typeof q === "object") return String(q.name ?? q.q ?? "").trim();
  return "";
}

export async function federatedSearchTop1(q){
  const query = keyOf(q);
  if (!query) return [];
  let agg;
  try {
    agg = await scrapePrices(query);
  } catch {
    return [];
  }
  const items = Array.isArray(agg?.items) ? agg.items : [];
  const normalized = items
    .map(it => {
      const price = Number(it?.price);
      const name = String(it?.name || "").trim();
      const store = String(it?.source || it?.store || "").trim();
      if (!Number.isFinite(price) || !name || !store) return null;
      return { store, name, price, url: it?.url || null };
    })
    .filter(Boolean);

  const bestByStore = new Map();
  for (const it of normalized) {
    const k = it.store.toLowerCase();
    const cur = bestByStore.get(k);
    if (!cur || it.price < cur.price) bestByStore.set(k, it);
  }

  return Array.from(bestByStore.values()).sort((a,b)=>a.price-b.price);
}

export default { federatedSearchTop1 };
