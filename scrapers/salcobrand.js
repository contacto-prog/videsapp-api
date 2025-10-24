// scrapers/salcobrand.js
import {
  sleep,
  tryDismissCookieBanners,
  safeGoto,
  pickCards,
  normalize,
  parsePrice,
} from './utils.js';

export const sourceId = 'salcobrand';

export async function fetchSalcobrand(page, product) {
  const q = encodeURIComponent(product);
  const candidates = [
    `https://www.salcobrand.cl/search?q=${q}`,
    `https://www.salcobrand.cl/s?q=${q}`,
    `https://www.salcobrand.cl/buscar?q=${q}`
  ];

  await page.setViewport({ width: 1280, height: 900 });

  let loaded = false;
  for (const url of candidates) {
    loaded = await safeGoto(page, url, 25000);
    if (!loaded) continue;
    await tryDismissCookieBanners(page, [
      '#onetrust-accept-btn-handler',
      'button:has-text("Aceptar")'
    ]);
    await sleep(1000);

    const ok = await page.waitForFunction(
      () => !!document.querySelector('.vtex-product-summary-2-x-container, .product-item, .product-card, [data-sku]'),
      { timeout: 8000 }
    ).catch(() => null);

    if (ok) break;
  }
  if (!loaded) return [];

  const items = await pickCards(page, {
    cards: '.vtex-product-summary-2-x-container, .product-item, .product-card, [data-sku], [data-testid*="product"]',
    name: [
      '.vtex-product-summary-2-x-productBrand, .vtex-product-summary-2-x-productName',
      '.product-name, .name, a[title]',
      'h3, h2'
    ],
    price: [
      '.vtex-product-price-1-x-sellingPriceValue, .vtex-product-price-1-x-sellingPrice',
      '.best-price, .price, [data-price]'
    ],
    link: ['a[href]']
  });

  const mapped = items.map(x => {
    const title = normalize(x.name);
    const price = parsePrice(x.price);
    if (!Number.isFinite(price) || !title) return null;
    return { title, price, url: x.link || page.url(), source: sourceId };
  }).filter(Boolean);

  return mapped;
}
