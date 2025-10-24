import {
  sleep, tryDismissCookieBanners, safeGoto, autoScroll, pickCards, normalize, parsePrice, tryVtexSearch,
} from './utils.js';

export const sourceId = 'cruzverde';

export async function fetchCruzVerde(page, product) {
  const q = encodeURIComponent(product);
  const url = `https://www.cruzverde.cl/search?q=${q}`;

  await page.setViewport({ width: 1280, height: 900 });
  await safeGoto(page, url, 20000);
  await tryDismissCookieBanners(page, ['#onetrust-accept-btn-handler', 'button:has-text("Aceptar")']);
  await sleep(300);
  await autoScroll(page, { steps: 12, delay: 220 });

  let items = await pickCards(page, {
    cards: '.product, .product-card, .product-grid .product-tile, [data-product-id], li.grid-tile',
    name: ['.pdp-link, .product-name, .name, .product-title, a[title]', 'h3, h2'],
    price: ['.product-sales-price, .sales, .price, .value, .best-price', '[data-price], .js-price, .prod__price'],
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
