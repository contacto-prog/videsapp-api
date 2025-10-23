// Utilidades comunes de scraping
export function normalizeProduct(q) {
  return (q || "").trim().toLowerCase();
}

export function pickPriceFromText(text) {
  // Encuentra $ 1.490, 1490, 1.490,00, etc.
  const re = /(?:\$|\bCLP\b)?\s*([0-9]{1,3}(?:[\.\s][0-9]{3})+|[0-9]+)(?:,[0-9]{2})?/g;
  let best = null;
  for (const m of text.matchAll(re)) {
    const raw = m[1].replace(/\s/g, "");
    const n = parseInt(raw.replace(/\./g, ""), 10);
    if (!Number.isNaN(n)) {
      if (n > 150 && n < 500000) { // filtros sanos
        if (best === null || n < best) best = n;
      }
    }
  }
  return best;
}

export async function extractJsonLdPrices(page) {
  const jsons = await page.$$eval('script[type="application/ld+json"]', nodes =>
    nodes.map(n => n.textContent).filter(Boolean)
  );
  for (const txt of jsons) {
    try {
      const data = JSON.parse(txt);
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) {
        // Offer/aggregateOffer
        const price = d?.offers?.price || d?.offers?.lowPrice || d?.price || d?.offers?.[0]?.price;
        if (price) {
          const n = parseInt(String(price).replace(/\D/g, ""), 10);
          if (!Number.isNaN(n)) return n;
        }
      }
    } catch { /* ignore */ }
  }
  return null;
}

export async function robustFirstPrice(page, extraSelectorHints = []) {
  // 1) JSON-LD primero
  const j = await extractJsonLdPrices(page);
  if (j) return j;

  // 2) Selectores típicos
  const selectors = [
    '[data-testid*="price"]',
    '[data-qa*="price"]',
    '[class*="price"]',
    '[class*="Price"]',
    '.product-price',
    '.price__current',
    ...extraSelectorHints,
  ];

  for (const sel of selectors) {
    try {
      const txt = await page.$eval(sel, el => el.innerText || el.textContent || "");
      const p = pickPriceFromText(txt);
      if (p) return p;
    } catch { /* sigue */ }
  }

  // 3) Fallback: barrido del body
  const body = await page.evaluate(() => document.body?.innerText || "");
  return pickPriceFromText(body);
}
