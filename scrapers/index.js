import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export const __INDEX_VERSION = 'v5-minimal-stable';

const HEADFUL = process.env.HEADFUL === '1';
const DEBUG   = process.env.DEBUG === '1';
const DEFAULT_NAV_TIMEOUT = 35000;

function log(...a){ if (DEBUG) console.log('[scrape]',...a); }

function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ').trim(); }
function keyProduct(s){ return norm(s).replace(/[^\w\s]/g,''); }

function getPriceFromText(txt){
  if(!txt) return null;
  const digits = txt.replace(/[^\d]/g,'');
  if(!digits) return null;
  const n = parseInt(digits,10);
  if(!Number.isFinite(n)) return null;
  if(n < 100 || n > 200000) return null;
  return n;
}

const SOURCES = [
  { id:'cruzverde',    url:q=>`https://www.cruzverde.cl/search?q=${encodeURIComponent(q)}`, sel:{row:['[data-product-id]','.product','.product-card','.product-tile','.product-list__item','article','li'], name:['h1','h2','h3','.product-title','a[title]','a'], price:['[class*=price]','.price','.product-price','.pricing','[data-price]']} },
  { id:'salcobrand',   url:q=>`https://salcobrand.cl/search?q=${encodeURIComponent(q)}`,     sel:{row:['.product','.product-grid__item','[data-sku]','article','li','.grid-item'], name:['h1','h2','h3','.product-title','.title','a[title]','a'], price:['[class*=price]','.price','.product-price','.pricing','[data-price]']} },
  { id:'ahumada',      url:q=>`https://www.farmaciasahumada.cl/search?q=${encodeURIComponent(q)}`, sel:{row:['.product-grid-item','.product-item','[data-product-id]','article','li','.grid-item'], name:['h1','h2','h3','.product-title','.title','a[title]','a'], price:['[class*=price]','.price','.product-price','.pricing','[data-price]']} },
  { id:'farmaexpress', url:q=>`https://farmex.cl/search?q=${encodeURIComponent(q)}`,         sel:{row:['.product-card','.product','article','.grid-item','li'], name:['h1','h2','h3','.product-title','.title','a[title]','a'], price:['[class*=price]','.price','.product-price','.pricing','[data-price]']} },
  { id:'drsimi',       url:q=>`https://www.drsimi.cl/catalogsearch/result/?q=${encodeURIComponent(q)}`, sel:{row:['.product-item','.item','[data-product-id]','article','li'], name:['h1','h2','h3','.product-title','.title','a[title]','a'], price:['[class*=price]','.price','.product-price','.pricing','[data-price]']} },
];

function dedupe(items){
  const seen=new Set(), out=[];
  for(const it of items){
    const k=[norm(it.source), (it.url||'').split('?')[0], norm(it.name)].join('|');
    if(seen.has(k)) continue; seen.add(k); out.push(it);
  }
  return out;
}

async function preparePage(page){
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8' });
  await page.emulateTimezone('America/Santiago');
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
  page.setDefaultNavigationTimeout(DEFAULT_NAV_TIMEOUT);
  page.setDefaultTimeout(DEFAULT_NAV_TIMEOUT);
}

async function runFallback(browser, source, q){
  const page = await browser.newPage();
  try{
    await preparePage(page);
    const url = source.url(q);
    log(source.id,'fallback →',url);
    await page.goto(url,{ waitUntil:'load', timeout:DEFAULT_NAV_TIMEOUT }).catch(()=>{});
    await page.waitForSelector('body',{ timeout:20000 }).catch(()=>{});
    await new Promise(r=>setTimeout(r,700));

    const rows = await page.evaluate(({id,sel})=>{
      const selList = sel.row.join(',');
      const nodes = Array.from(document.querySelectorAll(selList));
      const take=[];
      const norm=(s)=>String(s||'').replace(/\s+/g,' ').trim();
      const getP=(txt)=>{ if(!txt) return null; const d=txt.replace(/[^\d]/g,''); if(!d) return null; const n=parseInt(d,10); if(!Number.isFinite(n)) return null; if(n<100||n>200000) return null; return n; };
      for(const el of nodes){
        const nEl = el.querySelector(sel.name.join(',')) || el.closest('article, .product, .product-item, .product-card, .grid-item')?.querySelector(sel.name.join(','));
        const pEl = el.querySelector(sel.price.join(','));
        const aEl = el.querySelector('a');
        const name = norm(nEl?.textContent||'');
        const price = getP(pEl?.textContent||'');
        const url = aEl?.href || '';
        if(name && price && url) take.push({ source:id, name, price, url });
        if(take.length>=40) break;
      }
      return take;
    }, { id: source.id, sel: source.sel });

    log(source.id,'fallback_items:', Array.isArray(rows)?rows.length:0);
    return Array.isArray(rows)?rows:[];
  } finally {
    await page.close().catch(()=>{});
  }
}

export async function scrapePrices(product){
  const key = keyProduct(product);
  const browser = await puppeteer.launch({
    headless: HEADFUL ? false : 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--lang=es-CL,es;q=0.9,en;q=0.8','--window-size=1280,900']
  });

  const items=[], errors=[], sourcesTried=[];
  try{
    for(const s of SOURCES){
      sourcesTried.push(s.id);
      let rows=[];
      try{
        rows = await runFallback(browser, s, key);
      }catch(e){
        errors.push({ source:s.id, error:String(e&&e.message||e) });
      }
      if(Array.isArray(rows) && rows.length){
        for(const r of rows) items.push(r);
      }
    }
  } finally {
    await browser.close().catch(()=>{});
  }

  const unique = dedupe(items);
  const prices = unique.map(i=>i.price).filter(n=>Number.isFinite(n));
  const avg = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : null;

  return {
    _version: __INDEX_VERSION,
    product: key,
    averagePrice: avg,
    count: unique.length,
    items: unique,
    sources: sourcesTried,
    errors
  };
}
