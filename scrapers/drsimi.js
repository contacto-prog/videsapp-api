import {
  sleep, tryDismissCookieBanners, safeGoto, autoScroll, pickCards, normalize, parsePrice,
} from './utils.js';

export const sourceId = 'drsimi';

export async function fetchDrsimi(page, product) {
  const q = encodeURIComponent(product);
  const candidates = [
    `https://www.drsimi.cl/search?q=${q}`,
    `https://www.drsimi.cl/s?q=${q}`,
  ];

  await page.setViewport({ width: 1280, height: 900 });

  let loaded = false;
  for (const url of candidates) {
    loaded = await safeGoto(page, url, 20000);
    if (!loaded) continue;
    await tryDismissCookieBanners(page);
    await sleep(200);
    await autoScroll(page, { steps: 12, delay: 220 });
    const ok = await page.$('.product-item, .product-grid, [data-product-id], .product-card');
    if (ok) break;
  }
  if (!loaded) return [];

  const items = await pickCards(page, {
    cards: '.product-item, .product-card, [data-product-id], .product-grid .grid-tile',
    name: ['.product-title, .name, .pdp-link, a[title]', 'h3, h2'],
    price: ['.price, .product-sales-price, .best-price, .value', '[data-price]'],
    link: ['a[href]'],
  });

  return items.map(x => {
    const title = normalize(x.name);
    const price = parsePrice(x.price);
    if (!Number.isFinite(price) || !title) return null;
    return { title, price, url: x.link || page.url(), source: sourceId };
  }).filter(Boolean);
}
