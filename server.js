// server.js – VIDESAPP API (prices-lite + federado + nearby + prices API MVP)
import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import fs from "fs/promises";
import { searchChainPricesLite } from "./scrapers/chainsLite.js";

const BUILD  = "prices-lite-2025-11-13-mvp-fast";
const COMMIT = process.env.RENDER_GIT_COMMIT || null;
const PORT   = process.env.PORT || 8080;

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(compression());
app.use(morgan("tiny"));

// Timeout defensivo (respuesta 504 si algo se cuelga)
// Lo subimos a 30s para alinearlo mejor con el timeout de Flutter.
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
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sLat1 = Math.sin(dLat / 2), sLng1 = Math.sin(dLng / 2);
  const A =
    sLat1 * sLat1 +
    Math.cos(a.lat * Math.PI / 180) *
      Math.cos(b.lat * Math.PI / 180) *
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
    // usamos búsqueda del sitio (o Google site:drsimi.cl)
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

// estimación simple de precio solo para cadenas que queremos mostrar precio
function estimatedPriceCLP(query, chainKey) {
  const q = String(query || "").toLowerCase();
  const isParacetamol = q.includes("paracetamol") && q.includes("500");

  if (isParacetamol) {
    if (chainKey === "drsimi") return 500; // referencia barata
    if (chainKey === "farmaexpress") return 790; // referencia similar a lo que viste
    return null;
  }

  // para otros medi
