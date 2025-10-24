// scrapers/ahumada.js
export const sourceId = 'ahumada';

/**
 * Busca <key> en Farmacias Ahumada, toma hasta 5 links de producto
 * y extrae nombre, precio y disponibilidad. Si algo falla, devuelve [].
 * @param {import('puppeteer').Page} page
 * @param {string} key
 * @returns {Promise<Array<{source:string,url:string,name:string,price?:number,availability?:string}>>}
 */
export async function fetchAhumada(page, key) {
  const results = [];
  const q = encodeURIComponent(key);

  const extractPriceNumber = (txt) => {
    if (!txt) return undefined;
    const m = txt.match(/\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/);
    if (!m) return undefined;
    return Number(m[0].replace(/\$/g, '').replace(/\./g, '').replace(',', '.'));
  };

  try {
    const searchUrl = `https://www.farmaciasahumada.cl/search?q=${q}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Recolecta links a productos (hasta 5)
    const links = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (/\/product|\/products|\/medicamento|\/producto/i.test(href) && !href.includes('#')) {
          try { out.push(new URL(href, location.href).toString()); } catch {}
        }
      });
      return Array.from(new Set(out)).slice(0, 5);
    });

    for (const link of links) {
      try {
        await page.goto(link, { waitUntil: 'networkidle2', timeout: 60000 });
        const item = await page.evaluate(() => {
          const pick = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
          const title = pick('h1') || pick('[data-product-title]') || document.title;
          const priceText =
            pick('[class*="price"]') ||
            pick('.price') ||
            document.body.innerText;
          const txt = document.body.innerText || '';
          const availability = /Agregar al carro|Añadir al carrito|Disponible/i.test(txt)
            ? 'in_stock'
            : (/Agotado|Sin stock|No disponible/i.test(txt) ? 'out_of_stock' : 'unknown');
          return { title, priceText, availability };
        });

        results.push({
          source: 'ahumada',
          url: link,
          name: item.title || key,
          price: extractPriceNumber(item.priceText),
          availability: item.availability,
        });
      } catch {
        // ignora producto fallido y sigue con los demás
      }
    }
  } catch {
    // ignora errores de búsqueda y devuelve lo que haya
  }

  return results;
}
