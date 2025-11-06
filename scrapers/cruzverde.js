// scrapers/cruzverde.js
import {
  safeGoto,
  tryDismissCookieBanners,
  autoScroll,
  normalize,
  parsePriceCLP,
  pickPriceFromHtml,
  tryVtexSearch,
  pickCards,
} from "./utils.js";

export const sourceId = "cruzverde";

/**
 * Scraper Cruz Verde (Chile)
 * Estrategia:
 *  1) En la homepage, usa tryVtexSearch (endpoints internos VTEX).
 *  2) Si falla/vacío, abre la página de búsqueda y extrae desde el DOM.
 *  3) Fallback final: patrón CLP sobre tarjetas.
 */
export async function fetchCruzVerde(
  q,
  { puppeteer, headless = "new", executablePath } = {}
) {
  if (!puppeteer) throw new Error("fetchCruzVerde requiere puppeteer en opts");

  const browser = await puppeteer.launch({
    headless,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let page;
  try {
    page = await browser.newPage();

    /* ========== 1) VTEX API desde la homepage ========== */
    const homeOk = await safeGoto(page, "https://www.cruzverde.cl/", 25000);
    if (homeOk) {
      await tryDismissCookieBanners(page);
      // VTEX search directa (rápida y no depende del DOM visible)
      const vtex = await tryVtexSearch(page, q, (p) => p);
      if (Array.isArray(vtex) && vtex.length) {
        // Normalizamos y limitamos
        const seen = new Set();
        const out = [];
        for (const it of vtex) {
          const name = normalize(it.title);
          const price = parsePriceCLP(it.price);
          if (!name || !price) continue;
          const key = `${name}|${price}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({
              store: "Cruz Verde",
              name,
              price,
              img: null,         // VTEX no nos trae imagen en esta vía
              url: it.url || null,
              stock: true,
            });
          }
          if (out.length >= 40) break;
        }
        if (out.length) return out;
      }
    }

    /* ========== 2) Búsqueda visible en el sitio (DOM) ========== */
    // Varias implementaciones VTEX soportan estas rutas:
    const searchUrls = [
      `https://www.cruzverde.cl/search?q=${encodeURIComponent(q)}`,
      `https://www.cruzverde.cl/${encodeURIComponent(q)}?map=ft`,
      `https://www.cruzverde.cl/busca?q=${encodeURIComponent(q)}`,
    ];

    let got = [];
    for (const url of searchUrls) {
      const ok = await safeGoto(page, url, 25000);
      if (!ok) continue;

      await tryDismissCookieBanners(page);
      await autoScroll(page, { steps: 8, delay: 250 });
      await page.waitForTimeout(800);

      // Intento con selectores de VTEX y variaciones
      const cardsSelectors = {
        cards:
          [
            ".vtex-search-result-3-x-galleryItem",
            ".vtex-search-result-3-x-galleryItem--normal",
            ".vtex-product-summary-2-x-container",
            ".product-item",
            ".product-card",
            "li.product",
            ".shelf__item",
          ].join(","),
        name: [
          ".vtex-product-summary-2-x-productBrand",
          ".vtex-product-summary-2-x-productName",
          ".shelf__title",
          ".product-item-link",
          ".product-name",
          "a[title]",
        ],
        price: [
          ".vtex-product-price-1-x-sellingPriceValue",
          ".vtex-product-price-1-x-currencyInteger",
          ".best-price",
          ".price",
          ".product-price",
          "[data-bind*='price']",
        ],
        link: [
          "a.vtex-product-summary-2-x-clearLink",
          "a.product-item-link",
          "a[href*='/p']",
          "a[href^='/']",
        ],
      };

      const picked = await pickCards(page, cardsSelectors); // ya normaliza precio
      let mapped = (picked || []).map((r) => ({
        store: "Cruz Verde",
        name: normalize(r.name),
        price: r.price, // pickCards ya lo dejó como Number
        img: null,
        url: r.link || null,
        stock: true,
      }));

      // Si no logró por selectores, hacemos un fallback más agresivo
      if (!mapped.length) {
        const raw = await page.$$eval(
          cardsSelectors.cards,
          (nodes) =>
            nodes.map((card) => ({
              text: (card.innerText || card.textContent || "").trim(),
              html: card.outerHTML || "",
              name:
                (card.querySelector(".product-item-link") ||
                  card.querySelector(".vtex-product-summary-2-x-productBrand") ||
                  card.querySelector("a[title]"))?.textContent?.trim() || null,
              href:
                (card.querySelector("a.vtex-product-summary-2-x-clearLink") ||
                  card.querySelector("a.product-item-link") ||
                  card.querySelector("a[href^='/']"))?.href || null,
              img:
                (card.querySelector("img") ||
                  card.querySelector("picture img"))?.src || null,
            })) || []
        ).catch(() => []);

        mapped = raw
          .map((it) => {
            const name = normalize(it.name);
            const price =
              parsePriceCLP(it.text) ?? pickPriceFromHtml(it.html);
            return {
              store: "Cruz Verde",
              name,
              price: price ?? null,
              img: it.img || null,
              url: it.href || null,
              stock: true,
            };
          })
          .filter((x) => x.name && Number.isFinite(x.price) && x.price > 0);
      }

      got = got.concat(mapped);
      if (got.length >= 40) break;
    }

    // De-dup por (name|price)
    const seen = new Set();
    const dedup = [];
    for (const r of got) {
      const key = `${r.name}|${r.price}`;
      if (!seen.has(key)) {
        seen.add(key);
        dedup.push(r);
      }
      if (dedup.length >= 40) break;
    }

    return dedup;
  } catch (e) {
    if (process.env.DEBUG_PRICES) {
      console.error("[Cruz Verde] scraper error:", e?.message || e);
    }
    return [];
  } finally {
    try { await page?.close(); } catch {}
    await browser.close();
  }
}
