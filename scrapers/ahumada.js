// scrapers/ahumada.js
export const sourceId = 'ahumada';

/**
 * Scraper mínimo para Ahumada.
 * Devuelve [] si no puede extraer nada, pero NO bota el servicio.
 * @param {import('puppeteer').Page} _page
 * @param {string} _key
 * @returns {Promise<Array<{source:string,url:string,name:string,price?:number,availability?:string}>>}
 */
export async function fetchAhumada(_page, _key) {
  // Stub seguro: todavía no implementado, pero no rompe.
  return [];
}
