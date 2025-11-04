cd ~/src/videsapp-api
cat > scrapers/ahumada.js <<'EOF'
// scrapers/ahumada.js (ESM) — SFCC/Demandware
export const sourceId = 'ahumada';

function parsePriceToInt(txt) {
  if (!txt) return null;
  const m = String(txt).replace(/\s+/g,' ').match(/(\d{1,3}(?:\.\d{3})+|\d{3,})/);
  return m ? Number(m[1].replace(/\./g,'')) : null;
}

export async function fetchAhumada(page, query) {
  const base = 'https://www.farmaciasahumada.cl';
  const url  = `${base}/search?q=${encodeURIComponent(query)}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    // breve espera para que JS inserte tiles si aplica
    await page.waitForTimeout(800);

    // 1) Intento JSON-LD (ItemList/Product) directamente en la página
    const itemsFromJsonLd = await page.evaluate(() => {
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
                if (!p) continue;
                const name = (p.name || '').trim();
                const url  = p.url || null;
                const off  = Array.isArray(p.offers) ? p.offers[0] : p.offers;
                const price = off && (off.price || off.lowPrice || off.highPrice);
                const priceNum = typeof price === 'number' ? price : parsePrice(price);
                if (name && Number.isFinite(priceNum)) {
                  out.push({ source: 'ahumada', name, price: priceNum, url, available: true });
                }
              }
            } else if (b['@type'] === 'Product') {
              const name = (b.name || '').trim();
              const url  = b.url || null;
              const off  = Array.isArray(b.offers) ? b.offers[0] : b.offers;
              const price = off && (off.price || off.lowPrice || off.highPrice);
              const priceNum = typeof price === 'number' ? price : parsePrice(price);
              if (name && Number.isFinite(priceNum)) {
                out.push({ source: 'ahumada', name, price: priceNum, url, available: true });
              }
            }
          }
        } catch {}
      }
      return out;
    });

    if (itemsFromJsonLd && itemsFromJsonLd.length) {
      // dedupe básico por nombre
      const seen = new Set();
      return itemsFromJsonLd.filter(i => {
        const k = i.name.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }

    // 2) Fallback: tiles típicos SFCC
    const itemsFromTiles = await page.$$eval(
      '.product, .product-tile, .grid-tile, .product-grid .product, .search-result-items .product',
      (els) => {
        const parsePrice = (s) => {
          if (!s) return null;
          const m = String(s).replace(/\s+/g,' ').match(/(\d{1,3}(?:\.\d{3})+|\d{3,})/);
          return m ? Number(m[1].replace(/\./g,'')) : null;
        };
        const out = [];
        for (const el of els.slice(0, 24)) {
          const a = el.querySelector('.product-name a, .tile-body .pdp-link, a.link, a.name-link, a');
          const name = (a?.textContent || '').trim();
          const href = a?.getAttribute('href') || '';
          const priceTxt =
            el.querySelector('.price .value, .price .sales .value, .price__sales, .price, [data-price]')?.textContent || '';
          const price = parsePrice(priceTxt);
          if (name && Number.isFinite(price)) {
            out.push({ source: 'ahumada', name, price, url: href, available: true });
          }
        }
        return out;
      }
    );

    // absolutiza URLs
    return (itemsFromTiles || []).map(it => ({
      ...it,
      url: it.url ? new URL(it.url, base).toString() : url
    }));
  } catch {
    return [];
  }
}
EOF
