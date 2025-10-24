// scrapers/utils.js
export const sleep = (ms) => new Promise(res => setTimeout(res, ms));

export function normalizeProduct(q) {
  return (q || "").trim().toLowerCase();
}

export function pickPriceFromText(text) {
  const re = /(?:\$|\bCLP\b)?\s*([0-9]{1,3}(?:[\.\s][0-9]{3})+|[0-9]+)(?:,[0-9]{2})?/g;
  let best = null;
  for (const m of text.matchAll(re)) {
    const raw = m[1].replace(/\s/g, "");
    const n = parseInt(raw.replace(/\./g, ""), 10);
    if (!Number.isNaN(n)) {
      if (n > 150 && n < 500000) {
        if (best === null || n < best) best = n;
      }
    }
  }
  return best;
}

export async function extractJsonLdPrices(page) {
  const jsons = await page.$$eval('script[type="application/ld+json"]', nodes =>
    nodes.map(n => n.textContent).filter(Boolean)
  );
  for (const txt of jsons) {
    try {
      const data = JSON.parse(txt);
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) {
        const price = d?.offers?.price || d?.offers?.lowPrice || d?.price || d?.offers?.[0]?.price;
        if (price) {
          const n = parseInt(String(price).replace(/\D/g, ""), 10);
          if (!Number.isNaN(n)) return n;
        }
      }
    } catch {}
  }
  return null;
}

export async function robustFirstPrice(page, extraSelectorHints = []) {
  const j = await extractJsonLdPrices(page);
  if (j) return j;
  const selectors = [
    '[data-testid*="price"]',
    '[data-qa*="price"]',
    '[class*="price"]',
    '[class*="Price"]',
    '.product-price',
    '.price__current',
    '.best-price',
    '.value',
    ...extraSelectorHints,
  ];
  for (const sel of selectors) {
    try {
      const txt = await page.$eval(sel, el => el.innerText || el.textContent || "");
      const p = pickPriceFromText(txt);
      if (p) return p;
    } catch {}
  }
  const body = await page.evaluate(() => document.body?.innerText || "");
  return pickPriceFromText(body);
}

export async function tryDismissCookieBanners(page) {
  try {
    const texts = ['Aceptar', 'Acepto', 'Entendido', 'Continuar', 'De acuerdo', 'OK'];
    for (const t of texts) {
      const btn = await page.$x(`//button[contains(translate(.,"ACEPTO","acepto"), "${t.toLowerCase()}")]`);
      if (btn?.length) { await btn[0].click({ delay: 30 }); await page.waitForTimeout(200); }
    }
    const sels = [
      'button#onetrust-accept-btn-handler',
      '#onetrust-accept-btn-handler',
      'button[aria-label*="acept"]',
      '[id*="cookie"] button',
    ];
    for (const s of sels) {
      if (await page.$(s)) { await page.click(s).catch(()=>{}); await page.waitForTimeout(200); }
    }
  } catch {}
}

/* ========= Helpers nuevas para los scrapers ========= */

export async function safeGoto(page, url, timeout = 20000) {
  try {
    await page.goto(url, { waitUntil: ['domcontentloaded', 'networkidle2'], timeout });
    return true;
  } catch {
    try {
      await page.goto(url, { waitUntil: ['load'], timeout });
      return true;
    } catch {
      return false;
    }
  }
}

export function normalize(str) {
  if (!str) return '';
  return String(str).replace(/\s+/g, ' ').replace(/\u00A0/g, ' ').trim();
}

export function parsePrice(text) {
  if (!text) return NaN;
  let t = String(text).replace(/[^\d.,-]/g, '').replace(/\s+/g, '').trim();
  const comma = (t.match(/,/g) || []).length;
  const dot = (t.match(/\./g) || []).length;
  if (comma && dot) {
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (comma && !dot) {
    t = t.replace(',', '.');
  } else {
    if (dot && !comma) t = t.replace(/\./g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export async function pickCards(page, sels) {
  const { cards, name = [], price = [], link = [] } = sels;
  return await page.$$eval(cards, (nodes, nameSels, priceSels, linkSels) => {
    const pick = (el, sels) => {
      for (const s of sels) {
        const n = el.querySelector(s);
        if (n && n.textContent && n.textContent.trim()) return n.textContent.trim();
      }
      return null;
    };
    const pickLink = (el, sels) => {
      for (const s of sels) {
        const a = el.querySelector(s);
        if (a && a.href) return a.href;
      }
      return null;
    };
    return nodes.map(card => ({
      name: pick(card, nameSels),
      price: pick(card, priceSels),
      link: pickLink(card, linkSels),
    })).filter(x => x.name && x.price);
  }, name, price, link).catch(() => []);
}

