// scrapers/ahumada.js
import {
  sleep,
  tryDismissCookieBanners,
  safeGoto,
  pickCards,
  normalize,
  parsePrice,
} from './utils.js';

export const sourceId = 'ahumada';

export async function fetchAhumada(page, product) {
  const q = encodeURIComponent(product);
  const candidates = [
    `https://www.ahumada.cl/search?q=${q}`,
    `https://www.ahumada.cl/s?q=${q}`,
    `https://www.ahumada.cl/search?text=${q}`,
  ];

  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36');

  let loaded = false;
  for (const url of candidates) {
    loaded = await safeGoto(page, url, 25000);
    if (!loaded) continue;
    await tryDismissCookieBanners(page);
    await sleep(1000);

    const ok = await page.waitForFunction(
      () => !!document.querySelector('.vtex-product-summary-2-x-container, .product-item, [data-testid*="product"], [data-sku], [data-sku-id]'),
      { timeout: 7000 }
    ).catch(() => null);

    if (ok) break;
  }

  if (!loaded) return [];

  const items = await pickCards(page, {
    cards: '.vtex-product-summary-2-x-container, .product-item, [data-testid*="product"], [data-sku], [data-sku-id]',
    name: [
      '.vtex-product-summary-2-x-productBrand',
      '.vtex-product-summary-2-x-productName',
      '.product-item .name',
      '[data-testid*="name"]',
      'h3 a', 'h3', 'a[title]'
    ],
    price: [
      '.vtex-product-price-1-x-sellingPriceValue',
      '.vtex-product-price-1-x-currencyInteger',
      '.vtex-product-price-1-x-sellingPrice',
      '.selling-price__value',
      '[data-testid*="price"]',
      '[data-price]',
      'span[class*="price"]',
      '.best-price',
      '.price, .fa-price, .price__current'
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
