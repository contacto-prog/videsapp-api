cat > scrapers/searchfederated.js <<'EOF'
// scrapers/searchfederated.js
import puppeteer from "puppeteer";
import { normalize } from "./utils.js";

import { fetchAhumada } from "./ahumada.js";
import { fetchCruzVerde } from "./cruzverde.js";
import { fetchSalcobrand } from "./salcobrand.js";
import { fetchFarmaexpress } from "./farmaexpress.js";
import { fetchDrSimi } from "./drsimi.js";

function keyOf(q){
  if (typeof q === "string") return q.trim();
  if (q && typeof q === "object") return String(q.name ?? q.q ?? "").trim();
  return "";
}

const SOURCES = [
  ["Ahumada",      fetchAhumada],
  ["Cruz Verde",   fetchCruzVerde],
  ["Salcobrand",   fetchSalcobrand],
  ["Farmaexpress", fetchFarmaexpress],
  ["Dr. Simi",     fetchDrSimi],
];

export async function searchFederated(q, { headless = "new", executablePath } = {}) {
  const query = keyOf(q);
  if (!query) return [];

  const opts = {
    puppeteer,
    headless,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || executablePath,
  };

  const settled = await Promise.allSettled(
    SOURCES.map(async ([name, fn]) => {
      try {
        const res = await fn(query, opts);
        if (process.env.DEBUG_PRICES) {
          const withPrice = (res || []).filter(x => Number.isFinite(x?.price));
          console.error(\`[\${name}] total=\${res?.length || 0} conPrecio=\${withPrice.length}\`);
        }
        return res || [];
      } catch (e) {
        if (process.env.DEBUG_PRICES) console.error(\`[\${name}] ERROR:\`, e?.message || e);
        return [];
      }
    })
  );

  const flat = settled.flatMap(r => (r.status === "fulfilled" ? r.value : [])) || [];

  const items = flat
    .map(it => {
      const store = normalize(it?.store || it?.source || "");
      const name  = normalize(it?.name || "");
      const price = Number(it?.price);
      if (!store || !name || !Number.isFinite(price) || price <= 0) return null;
      return {
        store,
        name,
        price,
        img: it?.img || null,
        url: it?.url || null,
        stock: typeof it?.stock === "boolean" ? it.stock : true,
      };
    })
    .filter(Boolean);

  const seen = new Set();
  const dedup = [];
  for (const it of items) {
    const key = \`\${it.store}|\${it.name}|\${it.price}\`;
    if (!seen.has(key)) {
      seen.add(key);
      dedup.push(it);
    }
    if (dedup.length >= 120) break;
  }

  return dedup;
}

export async function federatedSearchTop1(q, opts = {}) {
  const all = await searchFederated(q, opts);
  if (!all.length) return [];
  const bestByStore = new Map();
  for (const it of all) {
    const k = it.store.toLowerCase();
    const cur = bestByStore.get(k);
    if (!cur || it.price < cur.price) bestByStore.set(k, it);
  }
  return Array.from(bestByStore.values()).sort((a, b) => a.price - b.price);
}

const defaultExport = { searchFederated, federatedSearchTop1 };
export default defaultExport;
EOF
