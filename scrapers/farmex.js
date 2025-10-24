// scrapers/farmex.js
import * as cheerio from 'cheerio';

export function parseFarmex(html, url){
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g,' ').trim();

  const name = $('h1, .product-title').first().text().trim() || (text.match(/Paracetamol.*?(comprimidos|tabletas)/i)?.[0] ?? '');
  const anyPrice = text.match(/\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/);
  const availability = /Agregar al carro|Disponible/i.test(text)
    ? 'in_stock'
    : (/Agotado|Sin stock/i.test(text) ? 'out_of_stock' : 'unknown');

  const strength = (text.match(/(\d+)\s*mg/i)?.[1]) || null;
  const pack = (text.match(/x\s*(\d+)\s*(Comprimidos?|Tabletas?)/i)?.[1]) || (text.match(/\b(\d+)\s*Comprimidos?\b/i)?.[1]) || null;
  const form = (text.match(/\d+\s*(Comprimidos?|Tabletas?)/i)?.[1]) || null;

  const toNumber = (s)=> s ? Number(s.replace(/\./g,'').replace(',','.')) : undefined;

  return {
    source: 'farmex',
    url,
    name,
    active: 'Paracetamol',
    strength_mg: strength ? Number(strength) : undefined,
    form,
    pack,
    price: anyPrice ? toNumber(anyPrice[0].replace('$','')) : undefined,
    availability,
  };
}
