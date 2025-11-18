// scrapers/drsimi.js
import {
  safeGoto,
  tryDismissCookieBanners,
  autoScroll,
  normalize,
  parsePriceCLP,
  pickPriceFromHtml,
  setPageDefaults,
  tryCloseRegionModal,
} from "./utils.js";

export const sourceId = "drsimi";

/**
 * Scraper Dr. Simi
 */
export async function fetchDrSimi(
  q,
  { puppeteer, headless = "new", executablePath } = {}
) {
  if (!puppeteer) throw new Error("fetchDrSimi requiere puppeteer en opts");

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

    // DrSimi no siempre tiene buen buscador, usamos Google site:drsimi.cl
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(
      `site:drsimi.cl ${q}`
    )}`;

    const ok = await safeGoto(page, googleUrl, 25000);
    if (!ok) {
      if (process.env.DEBUG_PRICES) {
        console.error("[DrSimi] safeGoto falló para URL:", googleUrl);
      }
      return [];
    }

    await tryDismissCookieBanners(page);
    await tryCloseRegionModal(page);
    await page.waitForTimeout(1200);

    // Tomamos el primer resultado que parezca producto
    const productUrl = await page.evaluate(() => {
      const links = Array.from(
        document.querySelectorAll("a[href^='http']")
      ) as HTMLAnchorElement[];
      for (const a of links) {
        const href = a.href || "";
        if (
          href.includes("drsimi.cl") &&
          (href.includes("/p") || href.includes("/producto") || href.includes("/products"))
        ) {
          return href;
        }
      }
      return null;
    });

    if (!productUrl) {
      if (process.env.DEBUG_PRICES) {
        console.log("[DrSimi] No se encontró URL de producto desde Google");
      }
      return [];
    }

    const ok2 = await safeGoto(page, productUrl, 25000);
    if (!ok2) return [];

    await tryDismissCookieBanners(page);
    await tryCloseRegionModal(page);
    await page.waitForTimeout(1200);
    await autoScroll(page, { steps: 4, delay: 250 });
    await page.waitForTimeout(500);

    const data = await page.evaluate(() => {
      const titleEl =
        document.querySelector("h1") ||
        document.querySelector("[data-testid*='product-name']") ||
        document.querySelector("h2");

      const imgEl =
        document.querySelector("img[alt*='mg']") ||
        document.querySelector("img[alt*='comprimidos']") ||
        document.querySelector("img");

      const priceContainer =
        document.querySelector("[class*='price']") ||
        document.querySelector("[data-testid*='price']") ||
        document.querySelector("body");

      return {
        title: titleEl?.textContent?.trim() || null,
        img: (imgEl as HTMLImageElement | null)?.src || null,
        priceText:
          priceContainer?.textContent || priceContainer?.innerText || "",
        url: window.location.href,
      };
    });

    const name = normalize(data.title || q);
    let price = parsePriceCLP(data.priceText);
    if (!price) {
      price = pickPriceFromHtml(data.priceText);
    }
    if (price && (price < 100 || price > 500000)) price = null;

    const results = [];
    if (name && price) {
      results.push({
        store: "Dr. Simi",
        name,
        price,
        img: data.img || null,
        url: data.url || productUrl,
        stock: true,
      });
    }

    if (process.env.DEBUG_PRICES) {
      console.log(
        `[DrSimi] q="${q}" -> final=${results.length} items, took=${Date.now() - started}ms`
      );
    }

    return results;
  } catch (e) {
    if (process.env.DEBUG_PRICES) {
      console.error("[DrSimi] scraper error", e);
    }
    return [];
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}
