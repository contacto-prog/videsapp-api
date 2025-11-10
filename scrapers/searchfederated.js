// scrapers/searchfederated.js – versión unificada VIDESAPP
import { searchAhumada } from "./ahumada.js";
import { searchCruzVerde } from "./cruzverde.js";
import { searchSalcobrand } from "./salcobrand.js";
import { searchFarmaexpress } from "./farmaexpress.js";
import { searchDrSimi } from "./drsimi.js";
import { nearestInfo } from "./utils.js";

/**
 * Definición de cadenas y etiquetas amigables
 */
const CHAINS = [
  { key: "ahumada",     label: "Farmacias Ahumada" },
  { key: "cruzverde",   label: "Cruz Verde" },
  { key: "salcobrand",  label: "Salcobrand" },
  { key: "farmaexpress",label: "Farmaexpress" },
  { key: "drsimi",      label: "Dr. Simi" }
];

/**
 * Busca productos en todas las cadenas activas
 * Devuelve una lista con precio, distancia y link a Google Maps.
 */
export async function searchFederated({ q, lat, lng, mapsKey }) {
  if (!q) return [];

  // 1️⃣ Ejecuta todos los scrapers disponibles
  const [ah, cv, sb, fx, ds] = await Promise.allSettled([
    searchAhumada(q),
    searchCruzVerde(q),
    searchSalcobrand(q),
    searchFarmaexpress(q),
    searchDrSimi(q)
  ]);

  const got = {
    ahumada:     (ah.value||[])[0]     || null,
    cruzverde:   (cv.value||[])[0]     || null,
    salcobrand:  (sb.value||[])[0]     || null,
    farmaexpress:(fx.value||[])[0]     || null,
    drsimi:      (ds.value||[])[0]     || null
  };

  // 2️⃣ Calcula distancia y link a Maps para cada cadena
  const dists = await Promise.all(
    CHAINS.map(c => nearestInfo(c.label, lat, lng, mapsKey))
  );
  const distMap = Object.fromEntries(
    CHAINS.map((c,i)=>[c.key, dists[i]])
  );

  // 3️⃣ Genera una salida por cada cadena (con placeholder si falta precio)
  const out = CHAINS.map(c => {
    const real = got[c.key];
    const d = distMap[c.key] || null;
    if (real) {
      return {
        pharmacy: c.key,
        name: real.name,
        price: real.price ?? null,
        distance_km: d ? d.km : null,
        maps_url: d ? d.maps_url : null
      };
    }
    return {
      pharmacy: c.key,
      name: `${c.label} — sin información`,
      price: null,
      distance_km: d ? d.km : null,
      maps_url: d ? d.maps_url : null
    };
  });

  // 4️⃣ Ordena primero por precio, luego distancia
  out.sort((a,b)=>{
    if (a.price == null && b.price != null) return 1;
    if (a.price != null && b.price == null) return -1;
    if (a.price != null && b.price != null && a.price !== b.price) return a.price - b.price;
    const da = a.distance_km ?? Infinity, db = b.distance_km ?? Infinity;
    return da - db;
  });

  return out;
}

/**
 * Versión top1 (compatibilidad con server viejo)
 */
export async function federatedSearchTop1(q, opts = {}) {
  const lat = Number(opts.lat || process.env.GEO_LAT || -33.4489);
  const lng = Number(opts.lng || process.env.GEO_LNG || -70.6693);
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY || "";
  const all = await searchFederated({ q, lat, lng, mapsKey });
  if (!all.length) return [];
  // solo devolver la más barata por cadena
  const bestByPharmacy = new Map();
  for (const it of all) {
    const k = it.pharmacy;
    const cur = bestByPharmacy.get(k);
    if (!cur || (it.price ?? Infinity) < (cur.price ?? Infinity)) {
      bestByPharmacy.set(k, it);
    }
  }
  return Array.from(bestByPharmacy.values());
}

const defaultExport = { searchFederated, federatedSearchTop1 };
export default defaultExport;
