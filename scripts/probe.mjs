// scripts/probe.mjs
import puppeteer from 'puppeteer';
import { launchBrowser, prepPage, dump } from '../scrapers/_debug.js';

const q = process.argv[2] || 'paracetamol';
const src = process.argv[3] || 'cruzverde';

const SEARCHES = {
  cruzverde: (q) => `https://www.cruzverde.cl/search?q=${encodeURIComponent(q)}`,
  salcobrand: (q) => `https://salcobrand.cl/search?q=${encodeURIComponent(q)}`,
  ahumada: (q) => `https://www.farmaciasahumada.cl/search?q=${encodeURIComponent(q)}`,
  farmaexpress: (q) => `https://farmex.cl/search?q=${encodeURIComponent(q)}`,
  drsimi: (q) => `https://www.drsimi.cl/catalogsearch/result/?q=${encodeURIComponent(q)}`
};

const CANDIDATES = {
  // pon varios candidatos por tienda; luego afinamos
  cruzverde: ['[data-product-id]', '.product-tile', '.product-list__item', 'article'],
  salcobrand: ['.product', '.product-grid__item', '[data-sku]', 'article'],
  ahumada: ['.product-grid-item', '.product-item', '[data-product-id]', 'article'],
  farmaexpress: ['.product-card', '.product', 'article', '.grid-item'],
  drsimi: ['.product-item', '.item', '[data-product-id]', 'article']
};

const url = SEARCHES[src]?.(q);
if (!url) {
  console.error('Fuente desconocida:', src);
  process.exit(1);
}

const run = async () => {
  const browser = await launchBrowser(puppeteer);
  const page = await browser.newPage();
  try {
    await prepPage(page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await dump(page, src, 'domcontentloaded');

    // Intenta aceptar cookies si aparece un botón típico
    const cookieBtn = await page.$x(
      "//button[contains(translate(., 'ACEPTAR', 'aceptar'),'acept') or contains(., 'Aceptar')]"
    );
    if (cookieBtn[0]) { await cookieBtn[0].click().catch(()=>{}); }
    await page.waitForTimeout(1200);

    // Espera algo de red/JS
    await page.waitForNetworkIdle({ idleTime: 1200, timeout: 15000 }).catch(()=>{});
    await dump(page, src, 'after-networkidle');

    const title = await page.title();
    const htmlLen = (await page.content()).length;
    console.log('TITLE:', title);
    console.log('HTML_LEN:', htmlLen);

    // Cuenta candidatos
    const counts = {};
    for (const sel of CANDIDATES[src]) {
      const n = await page.$$eval(sel, els => els.length).catch(() => 0);
      counts[sel] = n;
    }
    console.log('CANDIDATE_COUNTS:', counts);

    // Extrae un par de items tentativos muy genéricos
    const sample = await page.evaluate(() => {
      const getPrice = (txt) => {
        const m = (txt || '').replace(/\./g,'').match(/(\$?\s*\d[\d\s]*)/);
        if (!m) return null;
        return parseInt(m[1].replace(/[^\d]/g, ''), 10) || null;
      };
      const cards = Array.from(document.querySelectorAll('article, .product, .product-card, .product-item'))
        .slice(0, 5)
        .map(el => {
          const name = (el.querySelector('h3, h2, .product-title, .title, a[title]')?.textContent || '').trim();
          const priceTxt = (el.querySelector('.price, .product-price, [class*="price"]')?.textContent || '').trim();
          const link = el.querySelector('a')?.href || '';
          const price = getPrice(priceTxt);
          return { name, price, url: link };
        })
        .filter(x => x.name && x.url);
      return cards;
    });
    console.log('SAMPLE_FIRST_ITEMS:', sample);
  } finally {
    await browser.close();
  }
};

run();
