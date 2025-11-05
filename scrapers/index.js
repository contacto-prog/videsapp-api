import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export const __INDEX_VERSION = 'v5.1-minimal-textscan';

const HEADFUL = process.env.HEADFUL === '1';
const DEBUG   = process.env.DEBUG === '1';
const DEFAULT_NAV_TIMEOUT = 35000;

function log(...a){ if (DEBUG) console.log('[scrape]',...a); }

function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ').trim(); }
function keyProduct(s){ return norm(s).replace(/[^\w\s]/g,''); }

function priceFrom(txt){
  if(!txt) return null;
  const m = txt.match(/(?:\$|\b)\s*(\d{3}(?:[.\s]\d{3})*|\d{2,})/);
  if(!m) return null;
  const n = parseInt(m[1].replace(/[^\d]/g,''),10);
  if(!Number.isFinite(n)) return null;
  if(n < 100 || n > 200000) return null;
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
      const tokens = String(q).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').split(/\s+/).filter(t=>t.length>=2);
      const nodes = Array.from(document.querySelectorAll([
        'article','.product','.product-card','.product-tile','.product-list__item',
        '.product-grid-item','.product-item','.grid-item','.item','li','div'
      ].join(',')));
      const seen = new Set();
      const take = [];
      function okText(t){ if(!t) return false; const s=t.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,''); return tokens.every(T=>s.includes(T)); }
      function priceFrom(t){ if(!t) return null; const m=t.match(/(?:\$|\b)\s*(\d{3}(?:[.\s]\d{3})*|\d{2,})/); if(!m) return null; const n=parseInt(m[1].replace(/[^\d]/g,''),10); if(!Number.isFinite(n)||n<100||n>200000) return null; return n; }

      for(const el of nodes){
        const txt = el.innerText || '';
        if(!okText(txt)) continue;
        const price = priceFrom(txt);
        if(!price) continue;
        let name = txt.replace(/\s+/g,' ').trim();
        if(name.length>140) name = name.slice(0,140);
        let href = '';
        const a = el.querySelector('a[href]');
        if(a && a.href) href = a.href;
        const key = name+'|'+price+'|'+href;
        if(seen.has(key)) continue;
        seen.add(key);
        take.push({ source:id, name, price, url: href });
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
