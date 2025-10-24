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

/* ===== Robustez adicional ===== */

export async function safeGoto(page, url, timeout = 20000) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    return true;
  } catch {
    try {
      await page.goto(url, { waitUntil: 'load', timeout });
      return true;
    } catch {
      return false;
    }
  }
}

export async function autoScroll(page, { steps = 10, delay = 300 } = {}) {
  try {
    for (let i = 0; i < steps; i++) {
      await page.evaluate(() => { window.scrollBy(0, Math.ceil(window.innerHeight * 0.8)); });
      await sleep(delay);
    }
    await page.evaluate(() => window.scrollTo(0, Math.max(0, window.scrollY - 200)));
    await sleep(200);
  } catch {}
}

// VTEX: intenta varias rutas y devuelve [{title, price, url}]
export async function tryVtexSearch(page, product, mapItem = (p) => p) {
  try {
    const q = String(product || '').trim();
    if (!q) return [];
    const urls = [
      `/api/catalog_system/pub/products/search/${encodeURIComponent(q)}`,
      `/api/catalog_system/pub/products/search/?ft=${encodeURIComponent(q)}&_from=0&_to=20`
    ];
    const data = await page.evaluate(async (urlList) => {
      for (const u of urlList) {
        try {
          const r = await fetch(u, { credentials: 'include' });
          if (!r.ok) continue;
          const j = await r.json();
          if (Array.isArray(j) && j.length) return j;
        } catch {}
      }
      return null;
    }, urls);

    if (!Array.isArray(data) || !data.length) return [];

    const out = [];
    for (const p of data) {
      const name = p?.productName || p?.productTitle || p?.productReference || '';
      const sku = p?.items?.[0];
      const seller = sku?.sellers?.[0];
      const price = seller?.commertialOffer?.Price ?? seller?.commertialOffer?.price ?? null;
      let link = null;
      if (p?.link) link = p.link;
      else if (p?.linkText) link = `/${p.linkText}/p`;

      if (name && Number.isFinite(price)) {
        out.push(mapItem({
          title: name,
          price: Math.round(price),
          url: link || null,
        }));
      }
    }
    return out;
  } catch {
    return [];
  }
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
