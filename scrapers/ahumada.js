// scrapers/ahumada.js
import * as cheerio from 'cheerio';

export function parseAhumadaSearch(html, baseUrl){
  const $ = cheerio.load(html);
  const links = new Set();
  // Toma todos los <a> que parecen tarjeta de producto
  $('a[href*="/product"], a[href*="/producto"], a[href*="/medicamento"], a[href*="/products"]').each((_,a)=>{
    const href = $(a).attr('href');
    if(href && !href.includes('#')) links.add(new URL(href, baseUrl).toString());
  });
  // Fallback: captura cualquier <a> cercano a un nodo que contenga un precio
  if(links.size===0){
    $('a').each((_,a)=>{
      const $a=$(a); const near = $a.parent().text();
      if(/\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/.test(near)) {
        const href = $a.attr('href');
        if(href) links.add(new URL(href, baseUrl).toString());
      }
    });
  }
  return Array.from(links);
}
