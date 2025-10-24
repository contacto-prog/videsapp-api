import {
  sleep, tryDismissCookieBanners, safeGoto, pickCards, normalize, parsePrice,
} from './utils.js';

export const sourceId = 'farmaexpress';

export async function fetchFarmaexpress(page, product) {
  const q = encodeURIComponent(product);
  const url = `https://www.farmaexpress.cl/search?q=${q}`;

  await page.setViewport({ width: 1280, height: 900 });
  await safeGoto(page, url, 25000);
  await tryDismissCookieBanners(page);
  await sleep(1000);
  await page.waitForFunction(
    () => !!document.querySelector('.product-item, .vtex-product-summary-2-x-container, [data-sku], [data-testid*="product"]'),
    { timeout: 8000 }
  ).catch(() => null);

  const items = await pickCards(page, {
    cards: '.product-item, .vtex-product-summary-2-x-container, [data-sku], [data-testid*="product"]',
    name: ['.product-name, .name, .vtex-product-summary-2-x-productBrand, .vtex-product-summary-2-x-productName', 'h3, a[title]'],
    price: ['.best-price, .price, .vtex-product-price-1-x-sellingPriceValue, .vtex-product-price-1-x-sellingPrice', '[data-price]'],
    link: ['a[href]'],
  });

  return items.map(x => {
    const title = normalize(x.name);
    const price = parsePrice(x.price);
    if (!Number.isFinite(price) || !title) return null;
    return { title, price, url: x.link || page.url(), source: sourceId };
  }).filter(Boolean);
}
