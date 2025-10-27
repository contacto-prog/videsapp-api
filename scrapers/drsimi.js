cat > scrapers/drsimi.js <<'EOF'
// scrapers/drsimi.js (ESM) — VTEX
export const sourceId = 'drsimi';

function parsePriceToInt(txt) {
  if (!txt) return null;
  const m = String(txt).replace(/\s+/g,' ').match(/(\d{1,3}(?:\.\d{3})+|\d{3,})/);
  return m ? Number(m[1].replace(/\./g,'')) : null;
}

export async function fetchDrSimi(page, query) {
  const base = 'https://www.drsimi.cl';
  const url  = `${base}/catalogsearch/result/?q=${encodeURIComponent(query)}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(800);

    // 1) JSON-LD
    const fromJsonLd = await page.evaluate(() => {
      const out = [];
      const parsePrice = (s) => {
        if (!s) return null;
        const m = String(s).replace(/\s+/g,' ').match(/(\d{1,3}(?:\.\d{3})+|\d{3,})/);
        return m ? Number(m[1].replace(/\./g,'')) : null;
      };
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const sc of scripts) {
        try {
          const data = JSON.parse(sc.textContent || 'null');
          const blocks = Array.isArray(data) ? data : [data];
          for (const b of blocks) {
            if (!b) continue;
            if (b['@type'] === 'ItemList' && Array.isArray(b.itemListElement)) {
              for (const it of b.itemListElement) {
                const p = it.item || it;
                const name = (p?.name || '').trim();
                const url  = p?.url || null;
                const off  = Array.isArray(p?.offers) ? p.offers[0] : p?.offers;
                const priceField = off && (off.price || off.lowPrice || off.highPrice);
                const price = typeof priceField === 'number' ? priceField : parsePrice(priceField);
                if (name && Number.isFinite(price)) {
                  out.push({ source: 'drsimi', name, price, url, available: true });
                }
              }
            } else if (b['@type'] === 'Product') {
              const name = (b.name || '').trim();
              const url  = b.url || null;
              const off  = Array.isArray(b.offers) ? b.offers[0] : b.offers;
              const priceField = off && (off.price || off.lowPrice || off.highPrice);
              const price = typeof priceField === 'number' ? priceField : parsePrice(priceField);
              if (name && Number.isFinite(price)) {
                out.push({ source: 'drsimi', name, price, url, available: true });
              }
            }
          }
        } catch {}
      }
      return out;
    });

    if (fromJsonLd && fromJsonLd.length) {
      const seen = new Set();
      return fromJsonLd.filter(i => {
        const k = i.name.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }

    // 2) Fallback: componentes VTEX comunes
    const fromTiles = await page.$$eval(
      '.vtex-product-summary-2-x-container, .product, [data-testid*="product"], .vtex-search-result-3-x-galleryItem',
      (els) => {
        const parsePrice = (s) => {
          if (!s) return null;
          const m = String(s).replace(/\s+/g,' ').match(/(\d{1,3}(?:\.\d{3})+|\d{3,})/);
          return m ? Number(m[1].replace(/\./g,'')) : null;
        };
        const out = [];
        for (const el of els.slice(0, 24)) {
          const a = el.querySelector('a[href*="/p"], a[href*="/producto"], a[href*="/product"], a.vtex-product-summary-2-x-clearLink, a');
          const name = (a?.textContent || '').trim();
          const href = a?.getAttribute('href') || '';
          const priceTxt =
            el.querySelector('[data-price], .vtex-product-price-1-x-sellingPrice, .vtex-product-price-1-x-sellingPriceValue, .best-price, .price')?.textContent || '';
          const price = parsePrice(priceTxt);
          if (name && Number.isFinite(price)) {
            out.push({ source: 'drsimi', name, price, url: href, available: true });
          }
        }
        return out;
      }
    );

    return (fromTiles || []).map(it => ({
      ...it,
      url: it.url ? new URL(it.url, base).toString() : url
    }));
  } catch {
    return [];
  }
}
EOF
