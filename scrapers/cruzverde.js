import { robustFirstPrice } from './utils.js';

export const sourceId = 'cruzverde';

export async function fetchCruzVerde(page, product) {
  const q = encodeURIComponent(product);
  const url = `https://www.cruzverde.cl/search?q=${q}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Espera corta por resultados
  await page.waitForTimeout(1200);

  const price = await robustFirstPrice(page, ['.productPricing', '.price', '.ProductPrice']);
  const title = await page.$eval('title', el => el.innerText).catch(() => product);
  return price ? [{ title, price, url, source: sourceId }] : [];
}
