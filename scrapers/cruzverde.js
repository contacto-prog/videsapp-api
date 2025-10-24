// scrapers/cruzverde.js
export async function fetchCruzVerde(page, url){
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9' });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  // Espera título o fallback a texto completo
  await page.waitForFunction(() => !!document.querySelector('h1') || document.body.innerText.length > 2000, { timeout: 15000 });

  // Intenta selectores comunes
  const data = await page.evaluate(()=>{
    const pick = (sel)=>document.querySelector(sel)?.textContent?.trim();
    const text = document.body.innerText;

    const name = pick('h1') || pick('.pdp-title') || (text.match(/^[^\n]{8,120}/)?.[0] ?? '');

    const priceNode = document.querySelector('.price, .pdp-price, [class*="price"]');
    const priceTxt = priceNode?.textContent || text;
    const priceMatch = priceTxt.match(/\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?/);

    const skuMatch = text.match(/SKU:\s*([A-Z0-9-]+)/i);
    const availability = /Agregar al carro|Disponible/i.test(text) ? 'in_stock' : (/Agotado|No disponible/i.test(text) ? 'out_of_stock' : 'unknown');

    const strength = (text.match(/(\d+)\s*mg/i)?.[1]) || null;
    const pack = (text.match(/\b(\d+)\s*(Comprimidos?|Tabletas?)/i)?.[1]) || null;
    const form = (text.match(/\d+\s*(Comprimidos?|Tabletas?)/i)?.[1]) || null;

    return { name, priceTxt: priceMatch?.[0] ?? null, sku: skuMatch?.[1] ?? null, availability, strength, pack, form };
  });

  const toNumber = (s)=> s ? Number(s.replace(/\$/,'').replace(/\./g,'').replace(',','.')) : undefined;
  return {
    source: 'cruzverde',
    url,
    name: data.name,
    active: 'Paracetamol',
    strength_mg: data.strength ? Number(data.strength) : undefined,
    form: data.form ?? undefined,
    pack: data.pack ?? undefined,
    price: toNumber(data.priceTxt),
    sku: data.sku ?? undefined,
    availability: data.availability
  };
}
