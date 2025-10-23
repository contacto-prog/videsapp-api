import { robustFirstPrice, tryDismissCookieBanners, sleep } from './utils.js';

export const sourceId = 'salcobrand';

export async function fetchSalcobrand(page, product) {
  const q = encodeURIComponent(product);
  const url = `https://salcobrand.cl/search?q=${q}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await tryDismissCookieBanners(page);
  await sleep(1200);

  const price = await robustFirstPrice(page, ['.price', '.product-price', '.sb-price']);
  const title = await page.$eval('title', el => el.innerText).catch(() => product);
  return price ? [{ title, price, url, source: sourceId }] : [];
}
