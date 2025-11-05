import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export const __INDEX_VERSION = 'v5.2-textscan-clp';

const HEADFUL = process.env.HEADFUL === '1';
const DEBUG   = process.env.DEBUG === '1';
const DEFAULT_NAV_TIMEOUT = 35000;

function log(...a){ if (DEBUG) console.log('[scrape]',...a); }
function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ').trim(); }
function keyProduct(s){ return norm(s).replace(/[^\w\s]/g,''); }
function nonNumericTokens(q){ return norm(q).split(/\s+/).filter(t=>t.length>=2 && /[a-z]/.test(t)); }

function priceFrom(txt){
  if(!txt) return null;
  let m = txt.match(/\$\s*([0-9]{1,3}(?:[.\s][0-9]{3})+)/);
  if(!m) m = txt.match(/\b([0-9]{1,3}(?:[.\s][0-9]{3})+)\b/);
  if(!m) m = txt.match(/\$\s*([0-9]{3,})/);
  if(!m) return null;
  const n = parseInt(m[1].replace(/[^\d]/g,''),10);
  if(!Number.isFinite(n) || n < 500 || n > 200000) return null;
  return n;
}

const SOURCES = [
  { id:'cruzverde',    url:q=>`https://www.cruzverde.cl/search?q=${encodeURIComponent(q)}` },
  { id:'salcobrand',   url:q=>`https://salcobrand.cl/search?q=${encodeURIComponent(q)}` },
  { id:'ahumada',      url:q=>`https://www.farmaciasahumada.cl/search?q=${encodeURIComponent(q)}` },
  { id:'farmaexpress', url:q=>`https://farmex.cl/search?q=${encodeURIComponent(q)}` },
  { id:'drsimi',       url:q=>`https://www.drsimi.cl/catalogsearch/result/?q=${encodeURIComponent(q)}` },
];

function dedupe(items){
  const seen=new Set(), out=[];
  for(const it of items){
    const k=[norm(it.source),(it.url||'').split('?')[0],norm(it.name)].join('|');
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
    await new Promise(r=>setTimeout(r,800));

    const rows = await page.evaluate(({id,q})=>{
      const tokens = String(q).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').split(/\s+/).filter(t=>t.length>=2 && /[a-z]/.test(t));
      const bad = /(resultados de busqueda|busqueda|filtros|refine|precio \$0|decreto|normativa|ley|llama|llamanos|tel:|\+?\s?56\d{7,})/i;
      const priceSel = ['[class*=price]','[data-price]','.price','.product-price','.pricing','.js-price','.vtex-product-price'].join(',');
      const titleSel = 'h1,h2,h3,.product-title,.title,a[title]';
      const nodes = Array.from(document.querySelectorAll([
        'article','.product','.product-card','.product-tile','.product-list__item',
        '.product-grid-item','.product-item','.grid-item','.item','li','.vtex-product-summary-2-x-container','div'
      ].join(',')));
      const seen = new Set();
      const take = [];

      function priceFrom(t){
        if(!t) return null;
        let m = t.match(/\$\s*([0-9]{1,3}(?:[.\s][0-9]{3})+)/);
        if(!m) m = t.match(/\b([0-9]{1,3}(?:[.\s][0-9]{3})+)\b/);
        if(!m) m = t.match(/\$\s*([0-9]{3,})/);
        if(!m) return null;
        const n = parseInt(m[1].replace(/[^\d]/g,''),10);
        if(!Number.isFinite(n) || n < 500 || n > 200000) return null;
        return n;
      }
      function okTokens(text){
        const s = text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
        return tokens.every(t=>s.includes(t));
      }

      for(const el of nodes){
        let priceText = '';
        const pEl = el.querySelector(priceSel);
        if(pEl && pEl.innerText) priceText = pEl.innerText;
        const p = priceFrom(priceText || el.innerText || '');
        if(!p) continue;

        let name = '';
        const tEl = el.querySelector(titleSel);
        if(tEl && tEl.innerText) name = tEl.innerText;
        if(!name) name = (el.innerText||'').replace(/\s+/g,' ').trim();
        if(!name || bad.test(name)) continue;
        if(!okTokens(name)) continue;

        let href = '';
        const a = el.querySelector('a[href]');
        if(a && a.href) href = a.href;

        name = name.replace(/\s+/g,' ').trim();
        if(name.length>140) name = name.slice(0,140);

        const key = name+'|'+p+'|'+href;
        if(seen.has(key)) continue;
        seen.add(key);
        take.push({ source:id, name, price:p, url: href });
        if(take.length>=40) break;
      }
      return take;
    },{ id: source.id, q });

    log(source.id,'fallback_items:', Array.isArray(rows)?rows.length:0);
    return Array.isArray(rows)?rows:[];
  } finally {
    await page.close().catch(()=>{});
  }
}

export async function scrapePrices(product){
  const key = keyProduct(product);
  const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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
