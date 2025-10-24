import {
  sleep, tryDismissCookieBanners, safeGoto, pickCards, normalize, parsePrice,
} from './utils.js';

export const sourceId = 'cruzverde';

export async function fetchCruzVerde(page, product) {
  const q = encodeURIComponent(product);
  const url = `https://www.cruzverde.cl/search?q=${q}`;

  await page.setViewport({ width: 1280, height: 900 });
  await safeGoto(page, url, 25000);
  await tryDismissCookieBanners(page, ['#onetrust-accept-btn-handler', 'button:has-text("Aceptar")']);
  await sleep(1000);
  await page.waitForFunction(
    () => !!document.querySelector('.product, .search-results, .product-grid, [data-product-id]'),
    { timeout: 8000 }
  ).catch(() => null);

  const items = await pickCards(page, {
    cards: '.product, .product-grid .product-tile, [data-product-id], li.grid-tile, .product-card',
    name: [' .pdp-link, .product-name, .name, .product-title, a[title]', 'h3, h2'],
    price: ['.product-sales-price, .sales, .price, .value, .best-price', '[data-price], .js-price, .prod__price'],
    link: ['a[href]'],
  });

  return items.map(x => {
    const title = normalize(x.name);
    const price = parsePrice(x.price);
    if (!Number.isFinite(price) || !title) return null;
    return { title, price, url: x.link || page.url(), source: sourceId };
  }).filter(Boolean);
}
