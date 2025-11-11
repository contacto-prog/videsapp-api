// scrapers/drsimi.js
// Dr. Simi (Chile) – scraper liviano y tolerante a cambios.
// Intenta varias rutas de búsqueda y extrae (name, price, url) con heurísticas genéricas.

import { getText, headers, priceCLPnum, normalize } from "./utils.js";

function candidateSearchUrls(query) {
  const q = encodeURIComponent(query);
  return [
    // e-commerce / buscadores comunes
    `https://www.drsimi.cl/search?q=${q}`,
    `https://drsimi.cl/search?q=${q}`,

    // WordPress/WooCommerce
    `https://www.drsimi.cl/?s=${q}`,
    `https://drsimi.cl/?s=${q}`,

    // Algunas instancias usan /tienda
    `https://www.drsimi.cl/tienda/?s=${q}`,
    `https://drsimi.cl/tienda/?s=${q}`,
  ];
}

// Parseo tolerante
function parseHtmlToItems(html, baseUrl) {
  const items = [];

  // 1) Tarjetas de producto típicas (WooCommerce / grids)
  const cardRegex = /<(article|div)[^>]+class="[^"]*(product|grid|item)[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = cardRegex.exec(html))) {
    const chunk = m[3];

    // Nombre
    let name =
      (chunk.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i)?.[1] ??
       chunk.match(/title="([^"]+)"/i)?.[1] ??
       chunk.match(/data-product[-_ ]?title="([^"]+)"/i)?.[1] ??
       "").replace(/<[^>]+>/g, " ").trim();

    // Precio (CLP con o sin separadores)
    const priceRaw =
      chunk.match(/\$\s?\d{1,3}([.\s]\d{3})+([,\.]\d{1,2})?/i)?.[0] ??
      chunk.match(/\b\d{1,3}([.\s]\d{3})+([,\.]\d{1,2})?\b/)?.[0] ??
      null;
    const price = priceCLPnum(priceRaw);

    // URL
    const href =
      chunk.match(/<a[^>]+href="([^"]+)"[^>]*>(?!\s*<img)/i)?.[1] ??
      chunk.match(/<a[^>]+href='([^']+)'[^>]*>(?!\s*<img)/i)?.[1] ??
      null;
    const url = href
      ? (href.startsWith("http") ? href : new URL(href, baseUrl).toString())
      : null;

    if (!name) continue;
    items.push({ chain: "drsimi", name, price: price ?? null, url });
    if (items.length >= 30) break;
  }

  // 2) Fallback: anchors con precio cerca
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
        const items = parseHtmlToItems(r.text.toLowerCase(), url);
        if (items.length) {
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
  return [];
}

// Modo depuración: devuelve además el detalle de cada intento
export async function searchDrSimiDebug(q) {
  const tried = [];
  const urls = candidateSearchUrls(q);
  const hdrs = headers("https://www.drsimi.cl", "text/html,*/*");

  for (const url of urls) {
    try {
      const r = await getText(url, hdrs);
      const ok = r.status >= 200 && r.status < 300;
      const text = (r.text || "");
      const items = ok ? parseHtmlToItems(text.toLowerCase(), url) : [];
      tried.push({
        url,
        status: r.status,
        bytes: text.length,
        items_found: items.length,
      });
      if (items.length) {
        return { items: items.map(it => ({ ...it, chain: "drsimi" })), tried };
      }
    } catch (e) {
      tried.push({ url, status: "ERR", bytes: 0, items_found: 0, error: String(e?.message || e) });
    }
  }
  return { items: [], tried };
}
