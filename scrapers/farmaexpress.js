// scrapers/farmaexpress.js
// Intenta buscar en farmex.cl (Shopify) y farmaexpress.cl (Magento-like)
export const sourceId = 'farmaexpress';

/**
 * @param {import('puppeteer').Page} page
 * @param {string} key - producto normalizado, p.ej. "paracetamol"
 * @returns {Promise<Array<{source:string,url:string,name:string,price?:number,availability?:string}>>}
 */
export async function fetchFarmaexpress(page, key) {
  const results = [];
  const q = encodeURIComponent(key);

  // Helper común en el browser
  const extractPriceNumber = (txt) => {
    if (!txt) return undefined;
    const m = txt.match(/\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/);
    if (!m) return undefined;
    return Number(m[0].replace(/\$/g, '').replace(/\./g, '').replace(',', '.'));
  };

  // ---------- farmex.cl (Shopify típico) ----------
  try {
    const url = `https://farmex.cl/search?q=${q}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Captura enlaces de productos (hasta 5)
    const links = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (/\/products\//i.test(href) && !href.includes('#')) {
          try {
            out.push(new URL(href, location.href).toString());
          } catch {}
        }
      });
      return Array.from(new Set(out)).slice(0, 5);
    });

    for (const link of links) {
      await page.goto(link, { waitUntil: 'networkidle2', timeout: 30000 });
      const item = await page.evaluate(() => {
        const pick = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
        const title =
          pick('h1') ||
          pick('.product__title') ||
          pick('[class*="product-title"]') ||
          document.title;
        const txt = document.body.innerText || '';
        const priceElm =
          pick('[class*="price"]') ||
          pick('.price') ||
          pick('.product__price') ||
          null;

        const availability = /Agregar al carro|Añadir al carrito|Disponible/i.test(txt)
          ? 'in_stock'
          : (/Agotado|Sin stock|No disponible/i.test(txt) ? 'out_of_stock' : 'unknown');

        return { title, priceText: priceElm || txt, availability };
      });

      results.push({
        source: 'farmex',
        url: link,
        name: item.title || key,
        price: extractPriceNumber(item.priceText),
        availability: item.availability,
      });
    }
  } catch (_) {
    // Ignorar y seguir con farmaexpress.cl
  }

  // ---------- farmaexpress.cl (Magento-like) ----------
  try {
    const url = `https://www.farmaexpress.cl/catalogsearch/result/?q=${q}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const links = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (/\/product\/|\/products\/|\/producto\//i.test(href) && !href.includes('#')) {
          try {
            out.push(new URL(href, location.href).toString());
          } catch {}
        }
      });
      return Array.from(new Set(out)).slice(0, 5);
    });

    for (const link of links) {
      await page.goto(link, { waitUntil: 'networkidle2', timeout: 30000 });
      const item = await page.evaluate(() => {
        const pick = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
        const title =
          pick('h1') ||
          pick('.page-title') ||
          pick('[itemprop="name"]') ||
          document.title;

        const priceNode =
          pick('[class*="price"]') ||
          pick('.price') ||
          pick('.price-box') ||
          null;

        const txt = document.body.innerText || '';
        const availability = /Agregar al carro|Añadir al carrito|Disponible/i.test(txt)
          ? 'in_stock'
          : (/Agotado|Sin stock|No disponible/i.test(txt) ? 'out_of_stock' : 'unknown');

        return { title, priceText: priceNode || txt, availability };
      });

      results.push({
        source: 'farmaexpress',
        url: link,
        name: item.title || key,
        price: extractPriceNumber(item.priceText),
        availability: item.availability,
      });
    }
  } catch (_) {
    // Ignorar
  }

  // Si no encontró nada, no rompe: devuelve []
  return results;
}
