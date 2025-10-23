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
      if (n > 150 && n < 500000) { // filtro sano
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

// --- Helpers anti cookies/banners (best-effort) ---
export async function tryDismissCookieBanners(page) {
  try {
    // Click por texto
    const texts = ['Aceptar', 'Acepto', 'Entendido', 'Continuar', 'De acuerdo', 'OK'];
    for (const t of texts) {
      const btn = await page.$x(`//button[contains(translate(.,"ACEPTO","acepto"), "${t.toLowerCase()}")]`);
      if (btn?.length) { await btn[0].click({ delay: 30 }); await page.waitForTimeout(200); }
    }
    // Selectores típicos
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
