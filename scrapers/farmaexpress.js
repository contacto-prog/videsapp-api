// scrapers/farmaexpress.js (ESM)
export const sourceId = 'farmaexpress';

function parsePriceToInt(txt) {
  if (!txt) return null;
  const m = String(txt).replace(/\s+/g, ' ').match(/(\d{1,3}(\.\d{3})+|\d{3,})/);
  return m ? Number(m[1].replace(/\./g, '')) : null;
}

export async function fetchFarmaexpress(page, query) {
  const base = 'https://farmex.cl';
  const url = `${base}/search?q=${encodeURIComponent(query)}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1200);

    const html = await page.content();
    // Si Shopify mete un challenge, no reventamos: devolvemos []
    if (/shopify-challenge/i.test(html)) {
      return [];
    }

    // Extrae productos típicos (temas Shopify)
    const rows = await page.$$eval(
      '.product-grid .grid__item, .card-wrapper, .product-card, .product-item',
      (els) =>
        els.slice(0, 24).map((el) => {
          const a =
            el.querySelector('a.full-unstyled-link, a.card-information__text, a[href*="/products/"]');
          const name = a?.textContent?.trim() || '';
          const href = a?.getAttribute('href') || '';
          const priceTxt =
            el.querySelector('.price-item--regular, .price__regular, .price__container, .price, [data-price]')?.textContent || '';
          return { name, href, priceTxt };
        })
    );

    const items = [];
    for (const r of rows) {
      const name = (r.name || '').trim();
      const price = parsePriceToInt(r.priceTxt);
      const urlAbs = r.href ? new URL(r.href, base).toString() : url;
      if (name && Number.isFinite(price)) {
        items.push({
          source: sourceId,
          name,
          price,
          url: urlAbs,
          available: true,
        });
      }
    }

    return items;
  } catch {
    // Ante cualquier error (timeout, navegación), no romper flujo
    return [];
  }
}
