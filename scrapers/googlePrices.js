import puppeteer from 'puppeteer';

const HOST_TO_CHAIN = {
  'www.cruzverde.cl': 'Cruz Verde',
  'cruzverde.cl': 'Cruz Verde',
  'www.farmaciasahumada.cl': 'Ahumada',
  'farmaciasahumada.cl': 'Ahumada',
  'salcobrand.cl': 'Salcobrand',
  'www.salcobrand.cl': 'Salcobrand',
  'farmex.cl': 'Farmaexpress',
  'www.farmex.cl': 'Farmaexpress',
  'drsimi.cl': 'Dr. Simi',
  'www.drsimi.cl': 'Dr. Simi',
  'cofar.cl': 'Cofar',
  'www.cofar.cl': 'Cofar',
  'ecofarmacias.cl': 'EcoFarmacias',
  'www.ecofarmacias.cl': 'EcoFarmacias',
  'novasalud.cl': 'Novasalud',
  'www.novasalud.cl': 'Novasalud',
  'recetasolidaria.cl': 'Receta Solidaria',
  'www.recetasolidaria.cl': 'Receta Solidaria'
};

function toIntPrice(txt){
  if(!txt) return null;
  const m = txt.replace(/\s/g,'').match(/(?:clp|\$)\s*([\d\.]+)/i) || txt.match(/^\s*\$?\s*([\d\.\s]{3,})\s*(?:clp)?/i);
  if(!m) return null;
  const n = parseInt(String(m[1]).replace(/[^\d]/g,''),10);
  if(!Number.isFinite(n) || n < 200 || n > 1000000) return null;
  return n;
}

function mkMapsUrl(chain, lat=null, lng=null){
  const base = 'https://www.google.com/maps/dir/?api=1';
  const dest = encodeURIComponent('Farmacia ' + chain);
  if(lat!=null && lng!=null) return `${base}&destination=${dest}&origin=${lat},${lng}&travelmode=driving`;
  return `${base}&destination=${dest}&travelmode=driving`;
}

async function acceptConsent(page){
  try{
    const sels = [
      "//button[contains(., 'Acepto') or contains(., 'Aceptar') or contains(., 'Agree') or contains(., 'I agree')]",
      "button#L2AGLb",
      "button[aria-label*='Acept']",
      "button[aria-label*='Agree']",
      ".QS5gu" // botón común en Google
    ];
    for(const s of sels){
      let btns = s.startsWith('//') ? await page.$x(s) : await page.$$(s);
      if(btns && btns[0]) { await btns[0].click().catch(()=>{}); break; }
    }
  }catch{}
}

async function safeEval(page, fn, arg, retries=2){
  for(let i=0;i<=retries;i++){
    try { return await page.evaluate(fn, arg); }
    catch(e){
      const msg = String(e?.message||e);
      if(i === retries || !/Execution context was destroyed|Most likely because of a navigation|Target closed/i.test(msg)) throw e;
      try{ await page.waitForSelector('body',{timeout:3000}); }catch{}
      await new Promise(r=>setTimeout(r,600));
    }
  }
}

async function safeGoto(page, url, retries=2){
  for(let i=0;i<=retries;i++){
    try{
      await page.goto(url, {waitUntil:'domcontentloaded', timeout:45000});
      await safeEval(page, () => document.readyState, null, 1);
      await page.waitForSelector('body', {timeout:10000}).catch(()=>{});
      return;
    }catch(e){
      if(i===retries) throw e;
      await new Promise(r=>setTimeout(r,800));
    }
  }
}

async function extractFromSERP(page){
  return await safeEval(page, ()=>{
    const rows = [];
    const cards = Array.from(document.querySelectorAll('a h3'));
    for(const h3 of cards){
      const a = h3.closest('a');
      if(!a) continue;
      const title = h3.textContent || a.textContent || '';
      const url = a.href || '';
      const snip = a.parentElement?.parentElement?.querySelector('.VwiC3b, .yXK7lf, span')?.innerText || '';
      rows.push({title, url, snippet: snip});
    }
    const alt = Array.from(document.querySelectorAll('#search .MjjYud, #search .SoaBEf'));
    for(const g of alt){
      const a = g.querySelector('a[href]');
      const h3 = g.querySelector('h3');
      if(!a || !h3) continue;
      rows.push({title:h3.innerText||'', url:a.href, snippet:g.innerText||''});
    }
    return rows.slice(0,60);
  });
}

export async function searchGooglePrices(q, opts={}){
  const { lat=null, lng=null, headful=false } = opts;
  const browser = await puppeteer.launch({
    headless: headful ? false : 'new',
    args: [
      '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
      '--lang=es-CL,es;q=0.9','--window-size=1280,900',
      '--disable-features=site-per-process','--no-zygote'
    ]
  });
  let page = await browser.newPage();
  try{
    await page.setExtraHTTPHeaders({'Accept-Language':'es-CL,es;q=0.9,en;q=0.8'});
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

    const url = `https://www.google.com/search?q=${encodeURIComponent(q + ' precio')}&hl=es-CL&num=30`;
    await safeGoto(page, url, 2);
    await acceptConsent(page);

    let raw;
    try {
      raw = await extractFromSERP(page);
    } catch(e){
      if(/Target closed/i.test(String(e?.message||e))){
        page = await browser.newPage();
        await page.setExtraHTTPHeaders({'Accept-Language':'es-CL,es;q=0.9,en;q=0.8'});
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
        await safeGoto(page, url, 2);
        await acceptConsent(page);
        raw = await extractFromSERP(page);
      } else { throw e; }
    }

    const items = [];
    for(const r of raw){
      let host = '';
      try{ host = new URL(r.url).host; }catch{}
      const chain = HOST_TO_CHAIN[host] || null;
      if(!chain) continue;
      const price = toIntPrice(r.title) || toIntPrice(r.snippet);
      if(!price) continue;
      items.push({ chain, price, title: r.title, url: r.url, mapsUrl: mkMapsUrl(chain, lat, lng) });
    }

    const byChain = new Map();
    for(const it of items){
      const prev = byChain.get(it.chain);
      if(!prev || it.price < prev.price) byChain.set(it.chain, it);
    }
    const uniq = Array.from(byChain.values()).sort((a,b)=>a.price-b.price);
    return { ok:true, query:q, count: uniq.length, items: uniq };
  } finally {
    await browser.close().catch(()=>{});
  }
}
