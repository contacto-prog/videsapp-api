import cheerio from "cheerio";

/**
 * Extrae productos de Farmacias Ahumada (SFCC / Demandware) usando fetch.
 * Retorna los primeros N normalizados: { store, name, price, currency, url, available }
 */
export async function searchAhumada(query, { limit = 10, debug = false, baseUrl = "https://www.farmaciasahumada.cl" } = {}) {
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const $ = cheerio.load(html);

  const out = [];
  const dbg = { url, jsonld: 0, tiles: 0, notes: [] };

  // 1) JSON-LD (Product / ItemList)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const items = Array.isArray(data) ? data : [data];
      for (const block of items) {
        if (block["@type"] === "ItemList" && Array.isArray(block.itemListElement)) {
          for (const it of block.itemListElement) {
            const p = it.item || it;
            const candidate = normalizeJsonLdProduct(p, "Ahumada");
            if (candidate) out.push(candidate);
          }
        } else if (block["@type"] === "Product") {
          const candidate = normalizeJsonLdProduct(block, "Ahumada");
          if (candidate) out.push(candidate);
        }
      }
      if (items.length) dbg.jsonld += items.length;
    } catch (_) { /* ignore */ }
  });

  // 2) Fallback: tarjetas clásicas (product tiles)
  // Ajuste genérico SFCC: contenedores con clase "product" / "product-tile"
  $(".product, .product-tile").each((_, el) => {
    const name = $(el).find(".product-name a, .tile-body .pdp-link, a.link, a.name-link").first().text().trim();
    const href = $(el).find("a").first().attr("href");
    const priceTxt = $(el).find(".price .value, .price .sales .value, .price .sales, .price").first().text().replace(/\s+/g, " ");
    const price = pickPriceCLP(priceTxt);
    if (name && price != null) {
      out.push({
        store: "Ahumada",
        name,
        price,
        currency: "CLP",
        url: href ? absolute(baseUrl, href) : url,
        available: !/agotado|sin stock/i.test($(el).text())
      });
      dbg.tiles++;
    }
  });

  // ordena por precio y limita
  const dedup = deduplicate(out).sort((a, b) => a.price - b.price).slice(0, limit);
  return debug ? { items: dedup, debug: dbg } : dedup;
}

function normalizeJsonLdProduct(p, store) {
  if (!p) return null;
  const name = p.name || p["@id"];
  const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
  let price = null, currency = "CLP", available = true;
  if (offer) {
    price = offer.price ? Number(String(offer.price).replace(/[^\d]/g, "")) : null;
    currency = offer.priceCurrency || "CLP";
    const avail = offer.availability || offer.availabilityStarts || "";
    available = /InStock|instock/i.test(avail) || !/OutOfStock/i.test(avail);
  }
  const url = p.url || (offer && offer.url) || null;
  if (!name || price == null) return null;
  return { store, name: String(name).trim(), price, currency, url, available };
}

function pickPriceCLP(txt) {
  if (!txt) return null;
  const m = String(txt).match(/(\d{1,3}(\.\d{3})+|\d+)(?=(\s*|)CLP|$)/i) || String(txt).match(/(\d{3,})/);
  return m ? Number(m[1].replace(/\./g, "")) : null;
}

function absolute(base, href) {
  if (!href) return base;
  try { return new URL(href, base).toString(); } catch { return href; }
}

function deduplicate(list) {
  const seen = new Set();
  return list.filter(p => {
    const key = `${p.store}|${p.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
