import { robustFirstPrice, tryDismissCookieBanners, sleep } from './utils.js';

export const sourceId = 'ahumada';

export async function fetchAhumada(page, product) {
  const q = encodeURIComponent(product);
  const url = `https://www.ahumada.cl/search?q=${q}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await tryDismissCookieBanners(page);
  await sleep(1200);

  const price = await robustFirstPrice(page, ['.product-price', '.price', '.fa-price', '.price__current']);
  const title = await page.$eval('title', el => el.innerText).catch(() => product);
  return price ? [{ title, price, url, source: sourceId }] : [];
}
