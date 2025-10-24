// scrapers/salcobrand.js
import * as cheerio from 'cheerio';

export function parseSalcobrand(html, url){
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g,' ').trim();

  const name =
    $('h1').first().text().trim() ||
    (text.match(/Paracetamol.*?(Comprimidos|Capsulas|Tabletas)/i)?.[0] ?? '');

  const sku = (text.match(/SKU:\s*([A-Z0-9-]+)/i)?.[1]) || null;

  // Precios
  const priceInternet = text.match(/Precio Internet:\s*\$?\s*([\d\.\,]+)/i)?.[1];
  const priceStore    = text.match(/Precio (Farmacia|Normal):\s*\$?\s*([\d\.\,]+)/i)?.[2];
  const anyPrice      = text.match(/\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/);

  const bioeq = /Bioequivalente/i.test(text);
  const formato = (text.match(/Formato\s*([^\n]+)/i)?.[1] || '').trim();
  const pack = (formato.match(/(\d+)\s*(Comprimidos?|Capsulas?|Tabletas?)/i)?.[1]) || null;
  const form = (formato.match(/\d+\s*(Comprimidos?|Capsulas?|Tabletas?)/i)?.[1]) || null;

  // Dosis
  const strength = (text.match(/(\d+)\s*mg/i)?.[1]) || null;

  // Disponibilidad
  const availability = /Agregar al carro|Disponible/i.test(text)
    ? 'in_stock'
    : (/Producto no disponible|Agotado/i.test(text) ? 'out_of_stock' : 'unknown');

  const toNumber = (s)=> s ? Number(s.replace(/\./g,'').replace(',','.')) : undefined;

  return {
    source: 'salcobrand',
    url,
    name,
    active: 'Paracetamol',
    strength_mg: strength ? Number(strength) : undefined,
    form,
    pack,
    price_internet: toNumber(priceInternet),
    price_store: toNumber(priceStore),
    price: toNumber(priceInternet) ?? toNumber(priceStore) ?? (anyPrice ? toNumber(anyPrice[0].replace('$','')) : undefined),
    sku,
    bioequivalente: bioeq,
    availability
  };
}
