// scrapers/utils.js

/* ===== Utilidades básicas ===== */
export const sleep = (ms) => new Promise(res => setTimeout(res, ms));

export function normalizeProduct(q) {
  return (q || "").trim().toLowerCase();
}

/* ======== PARSEO ROBUSTO DE PRECIOS CLP ======== */
/**
 * Normaliza y convierte a entero CLP:
 *  "$ 10.990", "CLP 10.990", "10990", "10,990", "Precio: 10.990"  -> 10990
 *  Filtra fuera valores irreales (<$100 o >$500.000)
 */
export function parsePriceCLP(input) {
  if (input == null) return null;

  const s = String(input)
    .replace(/\u00A0/g, ' ')      // no-break space
    .replace(/CLP/gi, '')
    .replace(/pesos?/gi, '')
    .replace(/[^\d.,]/g, '')      // deja solo dígitos y separadores
    .trim();

  if (!s) return null;

  // Chile: tratamos todo como entero en CLP (sin decimales)
  const normalized = s
    .replace(/\./g, '')           // miles con punto
    .replace(/,/g, '');           // por si viniera con coma

  const n = Number.parseInt(normalized, 10);
  if (!Number.isFinite(n)) return null;
  if (n < 100 || n > 500000) return null; // rango razonable por unidad

  return n;
}

/**
 * Busca el primer precio con patrón CLP dentro de un HTML o innerText.
 * Útil como fallback cuando no hay selectores estables.
 */
export function pickPriceFromHtml(textOrHtml) {
  if (!textOrHtml) return null;
  const str = String(textOrHtml).replace(/\u00A0/g, ' ');
  // Captura formatos: $ 10.990 | CLP 10.990 | 10990 | 10,990
  const re = /(?:CLP|\$)?\s*\d{1,3}(?:[.\s]\d{3})+|\d{4,6}/g;
  let best = null;
  for (const m of str.matchAll(re)) {
    const p = parsePriceCLP(m[0]);
    if (p) {
      // elegimos el menor precio válido encontrado (evita precios tachados mayores)
      if (best == null || p < best) best = p;
    }
  }
  return best;
}

/**
 * Equivalente a lo que usaríamos dentro de evaluate() si tenemos una "card" DOM.
 * Recibe un elemento (en evaluate) o un HTML string (fuera) y prueba selectores comunes.
 */
export function extractPriceFromCardLike(cardHtmlOrText) {
  // fallback directo por HTML/texto
  return pickPriceFromHtml(cardHtmlOrText);
}

/* ===== Compatibilidad: mantiene tu API previa pero internamente usa el parser robusto ===== */
export function pickPriceFromText(text) {
  // compatible con tu firma original, ahora con parser robusto
  return pickPriceFromHtml(text);
}

/* ===== JSON-LD ===== */
export async function extractJsonLdPrices(page) {
  const jsons = await page.$$eval('script[type="application/ld+json"]', nodes =>
    nodes.map(n => n.textContent).filter(Boolean)
  );
  for (const txt of jsons) {
    try {
      const data = JSON.parse(txt);
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) {
        const price =
          d?.offers?.price ??
          d?.offers?.lowPrice ??
          d?.price ??
          d?.offers?.[0]?.price ??
          null;
        if (price != null) {
          const n = parsePriceCLP(price);
          if (n) return n;
        }
      }
    } catch {}
  }
  return null;
}

/* ===== Primer precio robusto en una página ===== */
export async function robustFirstPrice(page, extraSelectorHints = []) {
  // 1) JSON-LD primero
  const j = await extractJsonLdPrices(page);
  if (j) return j;

  // 2) Selectores típicos de precio
  const selectors = [
    '[itemprop="price"]',
    '[data-price]',
    '[data-testid*="price"]',
    '[data-qa*="price"]',
    '[class*="price"]',
    '[class*="Price"]',
    '.product-price',
    '.price__current',
    '.best-price',
    '.amount',
    '.value',
    ...extraSelectorHints,
  ];

  for (const sel of selectors) {
    try {
      const txt = await page.$eval(sel, el =>
        (el.getAttribute?.('content') ||
         el.getAttribute?.('data-price') ||
         el.textContent ||
         el.innerText ||
         '')
      );
      const p = parsePriceCLP(txt) ?? pickPriceFromHtml(txt);
      if (p) return p;
    } catch {}
  }

  // 3) Fallback total: revisar todo el body
  const body = await page.evaluate(() => document.body?.innerText || document.body?.textContent || '');
  return pickPriceFromHtml(body);
}

/* ===== Banners de cookies ===== */
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

/* ===== Robustez adicional navegación ===== */
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

/* === VTEX helpers === */
async function tryVtexState(page) {
  try {
    const state = await page.evaluate(() => {
      const w = window;
      if (w && w.__STATE__) return JSON.stringify(w.__STATE__);
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const s of scripts) {
        const t = s.textContent || '';
        if (t.includes('__STATE__')) return t;
      }
      return null;
    });
    if (!state) return [];

    const text = String(state);
    const items = [];
    const re = /"commertialOffer"\s*:\s*\{[^}]*"Price"\s*:\s*([0-9.]+)[^}]*\}[^}]*\}\s*,\s*"name"\s*:\s*"([^"]+)"/gi;
    let m;
    while ((m = re.exec(text))) {
      const price = Math.round(Number(m[1]));
      const title = m[2];
      if (title && Number.isFinite(price)) {
        items.push({ title, price, url: null });
      }
      if (items.length >= 40) break;
    }
    return items;
  } catch {
    return [];
  }
}

// VTEX: intelligent-search + search clásico + sc=1 y paginación amplia
export async function tryVtexSearch(page, product, mapItem = (p) => p) {
  try {
    const q = String(product || '').trim();
    if (!q) return [];

    const bases = [
      // Intelligent Search (muchos retailers nuevos lo usan)
      `/_v/api/intelligent-search/product_search/v1/?ft=${encodeURIComponent(q)}`,
      // Clásicos
      `/api/catalog_system/pub/products/search/${encodeURIComponent(q)}`,
      `/api/catalog_system/pub/products/search/?ft=${encodeURIComponent(q)}`,
      `/api/catalog_system/pub/products/search/?fq=ft:${encodeURIComponent(q)}`
    ];

    const scs = ['', '&sc=1', '&sc=2'];         // algunos usan sc=1
    const orders = ['', '&O=OrderByPriceASC'];  // orden por precio como variante
    const windows = [
      { from: 0, to: 19 },
      { from: 0, to: 40 },
      { from: 0, to: 60 },
      { from: 0, to: 100 }
    ];

    const data = await page.evaluate(async (bases_, scs_, orders_, windows_) => {
      const tryFetch = async (url) => {
        try {
          const r = await fetch(url, { credentials: 'include' });
          if (!r.ok) return null;
          const j = await r.json();
          if (Array.isArray(j) && j.length) return j;
          return null;
        } catch { return null; }
      };

      // 1) bases sin paginación (puras)
      for (const b of bases_) {
        const j = await tryFetch(b);
        if (j) return j;
      }
      // 2) combinaciones con sc y order
      for (const b of bases_) {
        for (const s of scs_) {
          for (const o of orders_) {
            const j = await tryFetch(`${b}${b.includes('?') ? '' : '?'}${b.includes('?') ? '' : ''}${s}${o}`.replace(/\?\&/, '?'));
            if (j) return j;
          }
        }
      }
      // 3) paginación amplia
      for (const b of bases_) {
        for (const w of windows_) {
          const sep = b.includes('?') ? '&' : '?';
          const j = await tryFetch(`${b}${sep}_from=${w.from}&_to=${w.to}`);
          if (j) return j;
        }
      }
      // 4) combinando todo (sc + order + paginación)
      for (const b of bases_) {
        for (const s of scs_) {
          for (const o of orders_) {
            for (const w of windows_) {
              const sep = b.includes('?') ? '&' : '?';
              const url = `${b}${sep}_from=${w.from}&_to=${w.to}${s}${o}`.replace(/\?\&/, '?');
              const j = await tryFetch(url);
              if (j) return j;
            }
          }
        }
      }
      return null;
    }, bases, scs, orders, windows);

    if (Array.isArray(data) && data.length) {
      const out = [];
      for (const p of data) {
        const name = p?.productName || p?.productTitle || p?.productReference || p?.productNameWithTag || '';
        const sku = p?.items?.[0];
        const seller = sku?.sellers?.[0];
        const price = seller?.commertialOffer?.Price ?? seller?.commertialOffer?.price ?? null;
        let link = null;
        if (p?.link) link = p.link;
        else if (p?.linkText) link = `/${p.linkText}/p`;
        const parsed = parsePriceCLP(price);
        if (name && parsed) {
          out.push(mapItem({ title: name, price: parsed, url: link || null }));
        }
      }
      if (out.length) return out;
    }

    // 5) Último intento: __STATE__
    const stateItems = await tryVtexState(page);
    if (stateItems.length) return stateItems.map(mapItem);

    return [];
  } catch {
    return [];
  }
}

/* ===== Pick cards con parseo de precio robusto ===== */
export async function pickCards(page, sels) {
  const { cards, name = [], price = [], link = [] } = sels;
  const raw = await page.$$eval(cards, (nodes, nameSels, priceSels, linkSels) => {
    const pick = (el, sels) => {
      for (const s of sels) {
        const n = el.querySelector(s);
        const txt = n && (n.textContent || n.innerText);
        if (txt && txt.trim()) return txt.trim();
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
      priceRaw: pick(card, priceSels) || card.innerText || card.textContent || '',
      link: pickLink(card, linkSels),
    })).filter(x => x.name && x.priceRaw);
  }, name, price, link).catch(() => []);

  // Normalizamos precios en Node para no depender del DOM
  return raw.map(r => ({
    name: normalize(r.name),
    price: parsePriceCLP(r.priceRaw) ?? pickPriceFromHtml(r.priceRaw),
    link: r.link || null,
  })).filter(x => x.name && Number.isFinite(x.price));
}

/* ===== Normalizadores legacy ===== */
export function normalize(str) {
  if (!str) return '';
  return String(str).replace(/\s+/g, ' ').replace(/\u00A0/g, ' ').trim();
}

/**
 * Conservamos la función legacy, pero ahora intenta usar nuestro parser CLP.
 * Nota: esta devuelve Number (puede traer decimales si el texto lo trae),
 * pero en Chile seguiremos retornando enteros en CLP cuando se pueda.
 */
export function parsePrice(text) {
  if (!text) return NaN;
  const byCLP = parsePriceCLP(text);
  if (byCLP) return byCLP;

  // fallback: heurística original
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
// === Stealth-lite: UA, idioma, webdriver, viewport, timezone ===
export async function setPageDefaults(page) {
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });

    await page.setExtraHTTPHeaders({
      "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
      "Upgrade-Insecure-Requests": "1",
    });

    // Oculta webdriver
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // Señales típicas
      window.chrome = window.chrome || {};
      const permissions = navigator.permissions.query;
      navigator.permissions.query = (parameters) =>
        permissions(parameters).then((res) => {
          if (parameters.name === "notifications") {
            return Object.assign(res, { state: Notification.permission });
          }
          return res;
        });
      Object.defineProperty(navigator, 'languages', { get: () => ['es-CL', 'es', 'en'] });
      Object.defineProperty(navigator, 'platform',  { get: () => 'MacIntel' });
    });

    // Opcional: ahorra ancho de banda pero deja XHR/fetch
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (type === "image" || type === "font" || type === "media") return req.abort();
      return req.continue();
    });
  } catch {}
}
// === Stealth-lite: UA, idioma, webdriver, viewport, timezone ===
export async function setPageDefaults(page) {
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
      "Upgrade-Insecure-Requests": "1",
    });
    // Oculta webdriver + señales típicas
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      window.chrome = window.chrome || {};
      const permissions = navigator.permissions.query;
      navigator.permissions.query = (parameters) =>
        permissions(parameters).then((res) => {
          if (parameters.name === "notifications") {
            return Object.assign(res, { state: Notification.permission });
          }
          return res;
        });
      Object.defineProperty(navigator, 'languages', { get: () => ['es-CL', 'es', 'en'] });
      Object.defineProperty(navigator, 'platform',  { get: () => 'MacIntel' });
    });

    // Bloquea imágenes/fuentes/medios (deja XHR/fetch)
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (type === "image" || type === "font" || type === "media") return req.abort();
      return req.continue();
    });
  } catch {}
}
// === Stealth-lite + helpers de retail (UA/idioma/webdriver/viewport/tz) ===
export async function setPageDefaults(page) {
  try {
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
      "Upgrade-Insecure-Requests": "1",
    });
    await page.emulateTimezone("America/Santiago");

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      window.chrome = window.chrome || {};
      const permissions = navigator.permissions.query;
      navigator.permissions.query = (parameters) =>
        permissions(parameters).then((res) => {
          if (parameters.name === "notifications") {
            return Object.assign(res, { state: Notification.permission });
          }
          return res;
        });
      Object.defineProperty(navigator, "languages", { get: () => ["es-CL", "es", "en"] });
      Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
    });

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const t = req.resourceType();
      if (t === "image" || t === "font" || t === "media") return req.abort();
      return req.continue();
    });
  } catch {}
}

// Cierra banners de cookies y modales de región comunes (VTEX/SB/CV)
export async function tryCloseRegionModal(page) {
  try {
    // Botones frecuentes
    const labels = [
      "Aceptar", "Acepto", "Entendido", "Continuar", "De acuerdo", "OK",
      "Cerrar", "No gracias", "Lo tengo",
      "Seleccionar", "Confirmar"
    ];
    // Selectores frecuentes VTEX de región/comuna
    const sels = [
      'button#onetrust-accept-btn-handler',
      '#onetrust-accept-btn-handler',
      'button[aria-label*="acept"]',
      '[id*="cookie"] button',
      '[class*="Modal"] button',
      '[data-testid*="close"]',
      '[aria-label="Cerrar"]',
      'button[title="Cerrar"]',
      'button[aria-label*="cerrar"]',
      '[data-bind*="region"], [data-testid*="region"], [data-testid*="comuna"] button',
    ];

    // 1) Por texto
    for (const t of labels) {
      const btns = await page.$x(`//button[contains(translate(normalize-space(.),"ACEPTAROKCERRARSELECTCONFIRM","aceptarokcerrarselectconfirm"), "${t.toLowerCase()}")]`);
      if (btns?.length) { await btns[0].click({ delay: 30 }).catch(()=>{}); await page.waitForTimeout(200); }
    }
    // 2) Por selector
    for (const s of sels) {
      const n = await page.$(s);
      if (n) { await n.click({ delay: 30 }).catch(()=>{}); await page.waitForTimeout(200); }
    }

    // 3) Click en overlay si existe
    const overlays = await page.$$('[role="dialog"], [class*="modal"], [class*="dialog"], .ReactModal__Overlay');
    if (overlays?.length) {
      await page.keyboard.press("Escape").catch(()=>{});
      await page.waitForTimeout(200);
    }
  } catch {}
}
