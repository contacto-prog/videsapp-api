import { robustFirstPrice, tryDismissCookieBanners, sleep } from './utils.js';

export const sourceId = 'cruzverde';

export async function fetchCruzVerde(page, product) {
  const q = encodeURIComponent(product);
  const url = `https://www.cruzverde.cl/search?q=${q}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await tryDismissCookieBanners(page);
  await sleep(1200); // reemplazo de page.waitForTimeout

  const price = await robustFirstPrice(page, ['.productPricing', '.price', '.ProductPrice']);
  const title = await page.$eval('title', el => el.innerText).catch(() => product);
  return price ? [{ title, price, url, source: sourceId }] : [];
}
