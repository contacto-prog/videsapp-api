// server.js
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// --- Mock de datos (ejemplo) ---
const PHARMACIES = [
  { id: "cruz-verde-001", name: "Cruz Verde Apoquindo", lat: -33.4104, lng: -70.5660 },
  { id: "salcobrand-002", name: "Salcobrand Kennedy",    lat: -33.4037, lng: -70.5783 },
  { id: "ahumada-003",   name: "Ahumada Las Condes",     lat: -33.4145, lng: -70.5991 },
  { id: "pf-004",        name: "Pet Farmacia Vitacura",  lat: -33.3826, lng: -70.5748 },
];

// Diccionario “producto → precios por farmacia”
const PRICE_CATALOG = {
  paracetamol: {
    "cruz-verde-001": 1490,
    "salcobrand-002": 1590,
    "ahumada-003": 1690,
  },
  ketoprofeno: {
    "cruz-verde-001": 3990,
    "salcobrand-002": 3890,
    "ahumada-003": 4190,
    "pf-004": 3990,
  },
};

// --- Utiles ---
const toRad = (deg) => (deg * Math.PI) / 180;
function distanceMeters(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const d = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * d;
}

// --- Endpoints ---
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "videsapp-api", ts: new Date().toISOString() });
});

/**
 * GET /prices?product=ketoprofeno&lat=-33.44&lng=-70.65&radius=5000
 */
app.get("/prices", (req, res) => {
  const product = String(req.query.product || "").trim().toLowerCase();
  const lat = req.query.lat ? Number(req.query.lat) : null;
  const lng = req.query.lng ? Number(req.query.lng) : null;
  const radius = req.query.radius ? Number(req.query.radius) : 5000; // m

  if (!product) {
    return res.status(400).json({ error: "Falta el parámetro 'product'." });
  }

  // “Proveedor” mock: lee del catálogo en memoria
  const priceMap = PRICE_CATALOG[product] || {};
  const items = PHARMACIES.map((ph) => {
    const price = priceMap[ph.id] ?? null;
    const hasCoords = lat !== null && lng !== null;
    const dist = hasCoords ? Math.round(distanceMeters({ lat, lng }, ph)) : null;

    return {
      pharmacyId: ph.id,
      pharmacy: ph.name,
      price, // null si no hay precio en este mock
      distance_m: dist, // null si no envías lat/lng
      lat: ph.lat,
      lng: ph.lng,
    };
  })
    // si enviaste lat/lng y radius, filtramos por radio
    .filter((it) => (lat && lng ? (it.distance_m ?? Infinity) <= radius : true))
    // orden: primero por precio (si existe), luego por distancia
    .sort((a, b) => {
      const ap = a.price ?? Infinity;
      const bp = b.price ?? Infinity;
      if (ap !== bp) return ap - bp;
      const ad = a.distance_m ?? Infinity;
      const bd = b.distance_m ?? Infinity;
      return ad - bd;
    });

  const pricesOnly = items.map((i) => i.price).filter((p) => typeof p === "number");
  const average =
    pricesOnly.length ? Math.round(pricesOnly.reduce((s, x) => s + x, 0) / pricesOnly.length) : null;

  res.json({
    product,
    averagePrice: average, // promedio simple de los disponibles
    count: items.length,
    items,
    note:
      pricesOnly.length
        ? "Precios de ejemplo (mock). Próximamente: fuentes reales."
        : "Sin precios en el mock para este producto. Próximamente: fuentes reales.",
  });
});

// Raíz informativa
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "API Videsapp funcionando",
    docs: ["/health", "/prices?product=paracetamol", "/prices?product=ketoprofeno&lat=-33.44&lng=-70.65&radius=5000"],
  });
});

// Render/Heroku usan PORT; local usa 10000
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
