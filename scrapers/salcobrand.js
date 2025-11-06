// scrapers/salcobrand.js
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

export const sourceId = "salcobrand";

/**
 * Scraper Salcobrand (Chile)
 * Estrategia:
 *  1) Probar endpoints VTEX desde la home.
 *  2) Probar rutas de búsqueda visibles (DOM) con múltiples selectores.
 *  3) Fallback: patrón CLP sobre innerText/HTML si los selectores fallan.
 */
export async function fetchSalcobrand(
  q,
  { puppeteer, headless = "new", executablePath } = {}
) {
  if (!puppeteer) throw new Error("fetchSalcobrand requiere puppeteer en opts");

  const browser = await puppeteer.launch({
    headless,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let page;
  try {
    page = await browser.newPage();

    /* ========== 1) VTEX desde la home ========== */
    const homeOk = await safeGoto(page, "https://www.salcobrand.cl/", 25000);
    if (homeOk) {
      await tryDismissCookieBanners(page);
      const vtex = await tryVtexSearch(page, q, (p) => p);
      if (Array.isArray(vtex) && vtex.length) {
        const seen = new Set();
        const out = [];
        for (const it of vtex) {
          const name = normalize(it.title);
          const price = parsePriceCLP(it.price);
          if (!name || !price) continue;
          const key = `${name}|${price}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            store: "Salcobrand",
            name,
            price,
            img: null,         // esta vía no trae imagen directa
            url: it.url || null,
            stock: true,
          });
          if (out.length >= 40) break;
        }
        if (out.length) return out;
      }
    }

    /* ========== 2) Búsqueda visible (DOM) ========== */
    const searchUrls = [
      // VTEX típicos
      `https://www.salcobrand.cl/search?q=${encodeURIComponent(q)}`,
      `https://www.salcobrand.cl/${encodeURIComponent(q)}?map=ft`,
      `https://www.salcobrand.cl/busca?q=${encodeURIComponent(q)}`,
      // Magento clásico (por si cae en legacy)
      `https://www.salcobrand.cl/catalogsearch/result/?q=${encodeURIComponent(q)}`,
    ];

    const cardsSelectors = {
      cards: [
        // VTEX
        ".vtex-search-result-3-x-galleryItem",
        ".vtex-product-summary-2-x-container",
        // Magento / genéricos
        ".product-item",
        ".product-item-info",
        "li.product",
        ".product-card",
        ".shelf__item",
      ].join(","),
      name: [
        // VTEX
        ".vtex-product-summary-2-x-productBrand",
        ".vtex-product-summary-2-x-productName",
        // Magento
        ".product-item-link",
        ".product-item-name a",
        "a.product-item-link",
        // genéricos
        ".product-card__title",
        ".card__heading",
        ".product-title",
        "a[title]",
      ],
      price: [
        // VTEX
        ".vtex-product-price-1-x-sellingPriceValue",
        ".vtex-product-price-1-x-currencyInteger",
        ".best-price",
        // Magento / genéricos
        ".price, .product-price, .price__current, .amount, [data-price], [itemprop='price']",
      ],
      link: [
        // VTEX
        "a.vtex-product-summary-2-x-clearLink",
        // Magento / genéricos
        "a.product-item-link",
        "a[href*='/p']",
        ".card__heading a",
        "a[href^='/']",
      ],
    };

    const all = [];
    for (const url of searchUrls) {
      const ok = await safeGoto(page, url, 25000);
      if (!ok) continue;

      await tryDismissCookieBanners(page);
      await autoScroll(page, { steps: 8, delay: 250 });
      await page.waitForTimeout(800);

      // 1) Intento con selectores (pickCards ya normaliza precio)
      let picked = await pickCards(page, cardsSelectors);
      let mapped = (picked || []).map((r) => ({
        store: "Salcobrand",
        name: normalize(r.name),
        price: r.price,
        img: null,
        url: r.link || null,
        stock: true,
      }));

      // 2) Fallback agresivo por patrón CLP
      if (!mapped.length) {
        const raw = await page.$$eval(
          cardsSelectors.cards,
          (nodes) =>
            nodes.map((card) => ({
              text: (card.innerText || card.textContent || "").trim(),
              html: card.outerHTML || "",
              name:
                (card.querySelector(".vtex-product-summary-2-x-productBrand") ||
                  card.querySelector(".vtex-product-summary-2-x-productName") ||
                  card.querySelector(".product-item-link") ||
                  card.querySelector(".product-item-name a") ||
                  card.querySelector(".product-card__title") ||
                  card.querySelector(".card__heading") ||
                  card.querySelector(".product-title") ||
                  card.querySelector("a[title]"))?.textContent?.trim() || null,
              href:
                (card.querySelector("a.vtex-product-summary-2-x-clearLink") ||
                  card.querySelector("a.product-item-link") ||
                  card.querySelector(".card__heading a") ||
                  card.querySelector("a[href*='/p']") ||
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
              store: "Salcobrand",
              name,
              price: price ?? null,
              img: it.img || null,
              url: it.href || null,
              stock: true,
            };
          })
          .filter((x) => x.name && Number.isFinite(x.price) && x.price > 0);
      }

      all.push(...mapped);
      if (all.length >= 40) break;
    }

    // De-dup por (name|price)
    const seen = new Set();
    const dedup = [];
    for (const r of all) {
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
      console.error("[Salcobrand] scraper error:", e?.message || e);
    }
    return [];
  } finally {
    try { await page?.close(); } catch {}
    await browser.close();
  }
}
