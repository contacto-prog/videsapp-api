// scrapers/salcobrand.js
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

export const sourceId = "salcobrand";

/**
 * Scraper Salcobrand
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
    const started = Date.now();
    page = await browser.newPage();
    await setPageDefaults(page);

    const url = `https://www.salcobrand.cl/search?text=${encodeURIComponent(q)}`;

    const ok = await safeGoto(page, url, 25000);
    if (!ok) {
      if (process.env.DEBUG_PRICES) {
        console.error("[Salcobrand] safeGoto falló para URL:", url);
      }
      return [];
    }

    await tryDismissCookieBanners(page);
    await tryCloseRegionModal(page);
    await page.waitForTimeout(1200);
    await autoScroll(page, { steps: 8, delay: 250 });
    await page.waitForTimeout(800);

    const results = [];

    // 1) VTEX
    let vtexItems = [];
    try {
      vtexItems = await tryVtexSearch(page, q);
    } catch (e) {
      if (process.env.DEBUG_PRICES) {
        console.error("[Salcobrand] Error en tryVtexSearch:", e);
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
          store: "Salcobrand",
          name,
          price: priceNum,
          img: item.img || null,
          url: item.url || null,
          stock: true,
        });
      }
    }

    // 2) Fallback DOM
    if (!results.length) {
      const cards = await pickCards(page, {
        cards:
          ".product-card, .vtex-product-summary-2-x-container, article, .product-item",
        name: [
          ".product-card__name",
          ".vtex-product-summary-2-x-productBrand",
          ".product-name",
          "h3 a",
          "h3",
        ],
        price: [
          ".product-card__price",
          ".vtex-product-price-1-x-sellingPriceValue",
          ".price",
          "[data-price]",
        ],
        link: [
          ".product-card a[href*='/products']",
          "a.vtex-product-summary-2-x-clearLink",
          "a[href*='/products']",
          "a[href*='/producto']",
          "a",
        ],
      });

      for (const c of cards) {
        const name = normalize(c.name);
        const priceNum = c.price;
        if (!name || !Number.isFinite(priceNum)) continue;

        results.push({
          store: "Salcobrand",
          name,
          price: priceNum,
          img: null,
          url: c.link || null,
          stock: true,
        });
      }

      if (!results.length) {
        const raw = await page.evaluate(() => {
          const sels = [
            ".product-card",
            ".vtex-product-summary-2-x-container",
            ".product-item",
            "article",
          ];
          const cards = document.querySelectorAll(sels.join(","));
          const out = [];
          cards.forEach((card) => {
            const titleEl =
              card.querySelector(".product-card__name") ||
              card.querySelector(".product-name a") ||
              card.querySelector("h3 a") ||
              card.querySelector("a[title]") ||
              card.querySelector("h3");

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
            store: "Salcobrand",
            name,
            price,
            img: null,
            url: it.href || null,
            stock: true,
          });
        }
      }
    }

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
        `[Salcobrand] q="${q}" -> VTEX=${Array.isArray(vtexItems) ? vtexItems.length : 0} items, final=${dedup.length} items, took=${Date.now() - started}ms`
      );
    }

    return dedup;
  } catch (e) {
    if (process.env.DEBUG_PRICES) {
      console.error("[Salcobrand] scraper error", e);
    }
    return [];
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}
