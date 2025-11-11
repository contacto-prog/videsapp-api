// scrapers/drsimi.js
// Buscador liviano para DR. SIMI (Chile) con tolerancia a cambios.
// Intenta varias rutas de búsqueda y extrae (nombre, precio, link) por patrones comunes.

import { getText, headers, priceCLPnum, normalize } from "./utils.js";

// Variantes de búsqueda que suelen existir (WordPress / tienda).
function candidateSearchUrls(query) {
  const q = encodeURIComponent(query);
  return [
    // e-commerce genéricos
    `https://www.drsimi.cl/search?q=${q}`,
    `https://drsimi.cl/search?q=${q}`,

    // WordPress/WooCommerce búsqueda por parámetro "s"
    `https://www.drsimi.cl/?s=${q}`,
    `https://drsimi.cl/?s=${q}`,

    // Fallback región (algunas tiendas usan subpath /tienda)
    `https://www.drsimi.cl/tienda/?s=${q}`,
    `https://drsimi.cl/tienda/?s=${q}`,
  ];
}

// Heurísticas de parseo de HTML (sin depender de una sola clase CSS)
function parseHtmlToItems(html, baseUrl) {
  const items = [];

  // 1) Trozos por "article"/"product" típicos de WooCommerce / grids
  const cardRegex = /<(article|div)[^>]+class="[^"]*(product|grid|item)[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = cardRegex.exec(html))) {
    const chunk = m[3];

    // Nombre (etiquetas típicas: h2, h3, a[title], data-product_title)
    let name =
      (chunk.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i)?.[1] ??
       chunk.match(/title="([^"]+)"/i)?.[1] ??
       chunk.match(/data-product[-_ ]?title="([^"]+)"/i)?.[1] ??
       "").replace(/<[^>]+>/g, " ").trim();

    // Precio (patrones CLP: $ 3.990 / 3.990 / 3990 / 3,990.00)
    const priceRaw =
      chunk.match(/\$\s?\d{1,3}([.\s]\d{3})+([,\.]\d{1,2})?/i)?.[0] ??
      chunk.match(/\b\d{1,3}([.\s]\d{3})+([,\.]\d{1,2})?\b/)?.[0] ??
      null;
    const price = priceCLPnum(priceRaw);

    // Link
    const href =
      chunk.match(/<a[^>]+href="([^"]+)"[^>]*>(?!\s*<img)/i)?.[1] ??
      chunk.match(/<a[^>]+href='([^']+)'[^>]*>(?!\s*<img)/i)?.[1] ??
      null;
    const url = href
      ? (href.startsWith("http") ? href : new URL(href, baseUrl).toString())
      : null;

    // Filtrado básico
    if (!name) continue;
    // Evitar tarjetas sin precio cuando claramente son banners, etc
    // (igual dejamos algunas sin precio porque el sitio puede ocultarlo con JS).
    items.push({ chain: "drsimi", name, price: price ?? null, url });
    if (items.length >= 30) break;
  }

  // 2) Si no encontramos nada con la estrategia anterior, busquemos anchors
  // con texto y un precio cerca (más laxo).
  if (items.length === 0) {
    const rowRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let r;
    while ((r = rowRegex.exec(html))) {
      const href = r[1];
      const content = r[2];
      const name = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!name || name.length < 3) continue;

      const near = html.slice(Math.max(0, r.index - 400), r.index + content.length + 400);
      const priceRaw =
        near.match(/\$\s?\d{1,3}([.\s]\d{3})+([,\.]\d{1,2})?/i)?.[0] ??
        near.match(/\b\d{1,3}([.\s]\d{3})+([,\.]\d{1,2})?\b/)?.[0] ??
        null;
      const price = priceCLPnum(priceRaw);

      const url = href
        ? (href.startsWith("http") ? href : new URL(href, baseUrl).toString())
        : null;

      // Guardamos aunque no haya price (puede mostrarse con JS)
      items.push({ chain: "drsimi", name, price: price ?? null, url });
      if (items.length >= 30) break;
    }
  }

  // Dedup por name+price
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = `${normalize(it.name)}|${it.price ?? "x"}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it);
    }
    if (out.length >= 30) break;
  }
  return out;
}

export async function searchDrSimi(q) {
  const urls = candidateSearchUrls(q);
  const hdrs = headers("https://www.drsimi.cl", "text/html,*/*");
  for (const url of urls) {
    try {
      const r = await getText(url, hdrs);
      if (r.status >= 200 && r.status < 300 && (r.text || "").length > 0) {
        const items = parseHtmlToItems(r.text, url);
        if (items.length) {
          // Normaliza el nombre (igual que otras cadenas)
          return items.map((x) => ({
            chain: "drsimi",
            name: x.name,
            price: x.price,
            url: x.url ?? url,
          }));
        }
      }
    } catch {
      // probar siguiente URL
    }
  }
  return []; // no hallado (el caller rellenará “sin información”)
}
