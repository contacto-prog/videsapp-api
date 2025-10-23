import { robustFirstPrice, tryDismissCookieBanners, sleep } from './utils.js';

export const sourceId = 'farmaexpress';

export async function fetchFarmaexpress(page, product) {
  const q = encodeURIComponent(product);
  const url = `https://www.farmaexpress.cl/search?q=${q}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await tryDismissCookieBanners(page);
  await sleep(1200);

  const price = await robustFirstPrice(page, ['.price', '.precio', '.product-price', '.current-price']);
  const title = await page.$eval('title', el => el.innerText).catch(() => product);
  return price ? [{ title, price, url, source: sourceId }] : [];
}
