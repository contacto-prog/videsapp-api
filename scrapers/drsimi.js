import cheerio from "cheerio";

/**
 * Dr. Simi (VTEX). Intenta JSON-LD (muy común en VTEX) y fallback de selectores.
 */
export async function searchDrSimi(query, { limit = 10, debug = false, baseUrl = "https://www.drsimi.cl" } = {}) {
  const url = `${baseUrl}/catalogsearch/result/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const $ = cheerio.load(html);

  const out = [];
  const dbg = { url, jsonld: 0, tiles: 0 };

  // 1) JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const items = Array.isArray(data) ? data : [data];
      for (const block of items) {
        if (block["@type"] === "ItemList" && Array.isArray(block.itemListElement)) {
          for (const it of block.itemListElement) {
            const p = it.item || it;
            const candidate = normalizeJsonLdProduct(p, "Dr. Simi");
            if (candidate) out.push(candidate);
          }
        } else if (block["@type"] === "Product") {
          const candidate = normalizeJsonLdProduct(block, "Dr. Simi");
          if (candidate) out.push(candidate);
        }
      }
      if (items.length) dbg.jsonld += items.length;
    } catch (_) { /* ignore */ }
  });

  // 2) Fallback: estructuras VTEX
  // En VTEX suelen existir contenedores con data-* y spans de precio.
  $('[data-testid], .vtex-product-summary-2-x-container, .product').each((_, el) => {
    const name = $(el).find('a[title], .vtex-product-summary-2-x-productBrand, .product-name, .name').first().text().trim();
    const href = $(el).find("a").first().attr("href");
    const priceTxt = $(el).find('[data-price], .vtex-product-price-1-x-sellingPrice, .price, .best-price').first().text();
    const price = pickPriceCLP(priceTxt);
    if (name && price != null) {
      out.push({
        store: "Dr. Simi",
        name,
        price,
        currency: "CLP",
        url: href ? absolute(baseUrl, href) : url,
        available: !/agotado|sin stock/i.test($(el).text())
      });
      dbg.tiles++;
    }
  });

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
    const avail = offer.availability || "";
    available = /InStock|instock/i.test(avail) || !/OutOfStock/i.test(avail);
  }
  const url = p.url || (offer && offer.url) || null;
  if (!name || price == null) return null;
  return { store, name: String(name).trim(), price, currency, url, available };
}

function pickPriceCLP(txt) {
  if (!txt) return null;
  const m = String(txt).match(/(\d{1,3}(\.\d{3})+|\d{3,})/);
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
