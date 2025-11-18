import { parsePriceCLP } from "./utils.js";

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
  "www.drsimi.cl": "Dr. Simi"
};

function mkMapsUrl(chain) {
  return `https://www.google.com/maps/dir/?api=1&destination=Farmacia ${encodeURIComponent(chain)}`;
}

export async function searchChainPricesLite(q) {
  const query =
    `${q} precio (site:cruzverde.cl OR site:farmaciasahumada.cl OR site:salcobrand.cl OR site:farmex.cl OR site:drsimi.cl)`;

  const url =
    `https://r.jina.ai/http://www.google.com/search?q=${encodeURIComponent(query)}&hl=es-CL&num=30`;

  let text = "";
  try {
    const res = await fetch(url);
    text = await res.text();
  } catch {
    return { ok: true, query: q, count: 0, items: [] };
  }

  const lines = text.split("\n").map(s => s.trim()).filter(Boolean);

  const items = [];
  for (const line of lines) {
    const price = parsePriceCLP(line);
    if (!price) continue;

    const match = line.match(/https?:\/\/[^\s]+/);
    if (!match) continue;

    let host = "";
    try {
      host = new URL(match[0]).host;
    } catch {}

    const chain = HOST_TO_CHAIN[host];
    if (!chain) continue;

    items.push({
      chain,
      price,
      url: match[0],
      mapsUrl: mkMapsUrl(chain)
    });
  }

  // dedupe por cadena, deja solo el más barato
  const map = new Map();
  for (const item of items) {
    const prev = map.get(item.chain);
    if (!prev || item.price < prev.price) {
      map.set(item.chain, item);
    }
  }

  const out = Array.from(map.values());
  out.sort((a, b) => a.price - b.price);

  return {
    ok: true,
    query: q,
    count: out.length,
    items: out
  };
}
