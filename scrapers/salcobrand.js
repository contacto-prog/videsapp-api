import {
  sleep, tryDismissCookieBanners, safeGoto, autoScroll, pickCards, normalize, parsePrice, tryVtexSearch,
} from './utils.js';

export const sourceId = 'salcobrand';

export async function fetchSalcobrand(page, product) {
  const q = encodeURIComponent(product);
  const candidates = [
    `https://www.salcobrand.cl/search?q=${q}`,
    `https://www.salcobrand.cl/s?q=${q}`,
    `https://www.salcobrand.cl/buscar?q=${q}`,
  ];

  await page.setViewport({ width: 1280, height: 900 });
  let loaded = false;
  for (const url of candidates) {
    loaded = await safeGoto(page, url, 20000);
    if (!loaded) continue;
    await tryDismissCookieBanners(page);
    await sleep(300);
    await autoScroll(page, { steps: 12, delay: 220 });
    const ok = await page.$('.vtex-product-summary-2-x-container, .product-item, .product-card, [data-sku], [data-testid*="product"]');
    if (ok) break;
  }
  if (!loaded) return [];

  let items = await pickCards(page, {
    cards: '.vtex-product-summary-2-x-container, .product-item, .product-card, [data-sku], [data-testid*="product"]',
    name: [
      '.vtex-product-summary-2-x-productBrand, .vtex-product-summary-2-x-productName',
      '.product-name, .name, a[title]',
      'h3, h2',
    ],
    price: [
      '.vtex-product-price-1-x-sellingPriceValue, .vtex-product-price-1-x-sellingPrice',
      '.best-price, .price, [data-price]',
    ],
    link: ['a[href]'],
  });

  if (!items.length) {
    const apiItems = await tryVtexSearch(page, product, (p) => ({
      title: p.title,
      price: p.price,
      url: p.url ? new URL(p.url, page.url()).href : page.url(),
      source: sourceId,
    }));
    if (apiItems.length) return apiItems;
  }

  return items.map(x => {
    const title = normalize(x.name);
    const price = parsePrice(x.price);
    if (!Number.isFinite(price) || !title) return null;
    return { title, price, url: x.link || page.url(), source: sourceId };
  }).filter(Boolean);
}
