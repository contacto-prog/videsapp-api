// scrapers/cruzverde.js
import {
  safeGoto,
  tryDismissCookieBanners,
  autoScroll,
  normalize,
  parsePriceCLP,
  pickPriceFromHtml,
  setPageDefaults,
  tryVtexSearch,
  tryCloseRegionModal,
  pickCards,
} from "./utils.js";

export const sourceId = "cruzverde";

/**
 * Scraper Farmacias Cruz Verde
 * @param {string} q
 * @param {{ puppeteer?: any, headless?: any, executablePath?: string }} opts
 * @returns {Promise<Array<{store:string,name:string,price:number,img?:string,url?:string,stock:boolean}>>}
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
    const started = Date.now();
    page = await browser.newPage();
    await setPageDefaults(page);

    const url = `https://www.cruzverde.cl/search?q=${encodeURIComponent(q)}`;

    const ok = await safeGoto(page, url, 25000);
    if (!ok) {
      if (process.env.DEBUG_PRICES) {
        console.error("[CruzVerde] safeGoto falló para URL:", url);
      }
      return [];
    }

    await tryDismissCookieBanners(page);
    await tryCloseRegionModal(page);
    await page.waitForTimeout(1200);
    await autoScroll(page, { steps: 8, delay: 250 });
    await page.waitForTimeout(800);

    const results = [];

    // 1) Intento VTEX (Cruz Verde suele estar montado sobre VTEX)
    let vtexItems = [];
    try {
      vtexItems = await tryVtexSearch(page, q);
    } catch (e) {
      if (process.env.DEBUG_PRICES) {
        console.error("[CruzVerde] Error en tryVtexSearch:", e);
      }
    }

    if (Array.isArray(vtexItems) && vtexItems.length) {
      for (const item of vtexItems) {
        const priceNum = parsePriceCLP(
          item.price ?? item.priceRaw ?? item.priceCLP ?? item
        );
        if (!priceNum || priceNum < 100 || priceNum > 500000) continue;

        const name = normalize(item.title || item.name || q);
        if (!name) continue;

        results.push({
          store: "Cruz Verde",
          name,
          price: priceNum,
          img: item.img || null,
          url: item.url || null,
          stock: true,
        });
      }
    }

    // 2) Fallback DOM: tarjetas de producto
    if (!results.length) {
      const cards = await pickCards(page, {
        cards:
          ".vtex-product-summary-2-x-container, article, .product-card, .shelf__item, .product-item",
        name: [
          ".vtex-product-summary-2-x-productBrand",
          ".product-name",
          ".shelf__name",
          "h3 a",
          "h3",
        ],
        price: [
          ".vtex-product-price-1-x-sellingPriceValue",
          ".price, .product-price",
          "[data-price]",
          ".shelf__price",
        ],
        link: [
          "a.vtex-product-summary-2-x-clearLink",
          "a.product-name",
          "a[href*='/producto']",
          "a[href*='/products']",
          "a",
        ],
      });

      for (const c of cards) {
        const name = normalize(c.name);
        const priceNum = c.price;
        if (!name || !Number.isFinite(priceNum)) continue;

        results.push({
          store: "Cruz Verde",
          name,
          price: priceNum,
          img: null,
          url: c.link || null,
          stock: true,
        });
      }

      // fallback extra: si no funcionó pickCards, hacemos un scrape genérico
      if (!results.length) {
        const raw = await page.evaluate(() => {
          const sels = [
            ".product-card",
            ".shelf__item",
            ".product-item",
            ".vtex-product-summary-2-x-container",
          ];
          const cards = document.querySelectorAll(sels.join(","));
          const out = [];
          cards.forEach((card) => {
            const titleEl =
              card.querySelector("h3 a") ||
              card.querySelector("a[title]") ||
              card.querySelector(".product-name a") ||
              card.querySelector(".product-name");

            const linkEl = card.querySelector("a[href*='/']");

            out.push({
              title: titleEl?.textContent?.trim() || null,
              href: linkEl?.href || null,
              text: (card.innerText || card.textContent || "").trim(),
              html: card.outerHTML || "",
            });
          });
          return out;
        });

        for (const it of raw) {
          const name = normalize(it.title);
          let price =
            parsePriceCLP(it.text) ??
            pickPriceFromHtml(it.html ?? it.text ?? "");
          if (price && (price < 100 || price > 500000)) price = null;
          if (!name || !price) continue;

          results.push({
            store: "Cruz Verde",
            name,
            price,
            img: null,
            url: it.href || null,
            stock: true,
          });
        }
      }
    }

    // dedupe + límite
    const seen = new Set();
    const dedup = [];
    for (const r of results) {
      const key = `${r.name}|${r.price}`;
      if (!seen.has(key)) {
        seen.add(key);
        dedup.push(r);
      }
      if (dedup.length >= 40) break;
    }

    if (process.env.DEBUG_PRICES) {
      console.log(
        `[CruzVerde] q="${q}" -> VTEX=${Array.isArray(vtexItems) ? vtexItems.length : 0} items, final=${dedup.length} items, took=${Date.now() - started}ms`
      );
    }

    return dedup;
  } catch (e) {
    if (process.env.DEBUG_PRICES) {
      console.error("[CruzVerde] scraper error", e);
    }
    return [];
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}
