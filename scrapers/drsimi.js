// scrapers/drsimi.js
import { robustFirstPrice, tryDismissCookieBanners } from './utils.js';

export const sourceId = 'drsimi';

export async function fetchDrSimi(page, product) {
  const q = encodeURIComponent(product);
  const url = `https://www.drsimi.cl/search?q=${q}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await tryDismissCookieBanners(page);
  await page.waitForTimeout(1200);

  const price = await robustFirstPrice(page, ['.price', '.precio', '.product-price', '.productbox-price']);
  const title = await page.$eval('title', el => el.innerText).catch(() => product);
  return price ? [{ title, price, url, source: sourceId }] : [];
}
