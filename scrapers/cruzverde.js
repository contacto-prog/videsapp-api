// scrapers/cruzverde.js
import {
  tryDismissCookieBanners,
  autoScroll,
  pickCards,
  normalize,
  pickPriceFromText,
  setPageDefaults,
  safeGoto,
} from "./utils.js";

export const sourceId = "cruzverde";

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
    const query = String(q || "").trim();
    if (!query) return [];

    page = await browser.newPage();
        await setPageDefaults(page);

    // 1) Ir al sitio (CORS/cookies) y dar chance a banners
      await safeGoto(page, "https://www.cruzverde.cl/", 30000);
    await tryDismissCookieBanners(page).catch(() => {});
    await autoScroll(page, { steps: 4, delay: 150 });

    // 2) INTENTO PRINCIPAL: SFCC Open Commerce API (lo mismo que viste en Preview)
    const sfcc = await page.evaluate(async (qStr) => {
      const url = `https://www.cruzverde.cl/s/Chile/dw/shop/v19_1/product_search?q=${encodeURIComponent(qStr)}&start=0&count=24`;
      try {
        const r = await fetch(url, { credentials: "include" });
        if (!r.ok) return null;
        const j = await r.json();
        if (j && j.type === "product_search_result" && Array.isArray(j.hits)) {
          const out = [];
          for (const h of j.hits) {
            const name = (h?.productName || "").trim();
            const prices = h?.prices || {};
            const price = Number(prices["price-sale-cl"] ?? prices["price-list-cl"]);
            const urlPdp = typeof h?.link === "string" ? h.link : null;
            if (name && Number.isFinite(price)) {
              out.push({
                store: "Cruz Verde",
                name,
                price: Math.round(price),
                url: urlPdp,
                stock: typeof h?.stock === "number" ? h.stock > 0 : true,
              });
@@ -131,107 +130,134 @@ export async function fetchCruzVerde(
          }
          if (take.length >= 60) break;
        }
        return take.length ? take : null;
      } catch {
        return null;
      }
    }, query);

    if (Array.isArray(svc) && svc.length) {
      const seen = new Set();
      const out = [];
      for (const it of svc) {
        const k = `${it.name}|${it.price}|${it.url || ""}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push(it);
        }
        if (out.length >= 60) break;
      }
      return out;
    }

    // 4) ÚLTIMO RECURSO: DOM
    const searchUrl = `https://www.cruzverde.cl/search?query=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await safeGoto(page, searchUrl, 30000);
    await tryDismissCookieBanners(page).catch(() => {});
    await page.waitForTimeout(1200);
    await autoScroll(page, { steps: 8, delay: 200 });
    await page.waitForResponse(
      (r) => /product-service\/products\/search|dw\/shop\//i.test(r.url()),
      { timeout: 8000 }
    ).catch(() => {});
    await page
      .waitForSelector(
        [
          ".product-card",
          "[data-testid='product-card']",
          "[class*='ProductCard']",
          ".vtex-search-result-3-x-galleryItem",
        ].join(","),
        { timeout: 12000 }
      )
      .catch(() => {});

    const cardsSelectors = {
      cards: [
        ".product-card",
        ".vtex-search-result-3-x-galleryItem",
        ".vtex-product-summary-2-x-container",
        "li.product",
        ".shelf__item",
        "[data-testid='product-card']",
        "[class*='ProductCard']",
      ].join(","),
      name: [
        ".product-card__title",
        ".vtex-product-summary-2-x-productName",
        ".vtex-product-summary-2-x-productBrand",
        ".product-item-link",
        "a[title]",
        "[data-testid='product-card-name']",
        "[class*='ProductCard'] [class*='Title']",
      ],
      price: [
        ".product-price",
        ".price",
        ".best-price",
        ".vtex-product-price-1-x-sellingPriceValue",
        ".vtex-product-price-1-x-currencyInteger",
        "[data-testid='price']",
        "[data-testid*='Price']",
        "[class*='price']",
      ],
      link: [
        "a.product-item-link",
        "a[href*='/p']",
        "a[href^='/']",
        "[data-testid='product-card'] a",
      ],
    };

    let picked = await pickCards(page, cardsSelectors);
    let mapped = (picked || []).map((r) => ({
      store: "Cruz Verde",
      name: normalize(r.name),
      price: r.price,
      url: r.link || null,
      stock: true,
    }));

    if (!mapped.length) {
      const raw = await page.$$eval(
        cardsSelectors.cards,
        (nodes) =>
          nodes.map((card) => ({
            text: (card.innerText || card.textContent || "").trim(),
            html: card.outerHTML || "",
            name:
              (card.querySelector(".product-card__title") ||
                card.querySelector(".vtex-product-summary-2-x-productName") ||
                card.querySelector(".vtex-product-summary-2-x-productBrand") ||
                card.querySelector(".product-item-link") ||
                              card.querySelector("a[title]") ||
                card.querySelector("[data-testid='product-card-name']") ||
                card.querySelector("[class*='ProductCard'] [class*='Title']"))?.textContent?.trim() || null,
            href:
              (card.querySelector("a.product-item-link") ||
                card.querySelector("[data-testid='product-card'] a") ||
                card.querySelector("a[href*='/p']") ||
                card.querySelector("a[href^='/']"))?.href || null,
          })) || []
      ).catch(() => []);

      mapped = raw
        .map((it) => {
          const name = normalize(it.name);
          const price = pickPriceFromText(it.text) || pickPriceFromText(it.html);
          return {
            store: "Cruz Verde",
            name,
            price: price ?? null,
            url: it.href || null,
            stock: true,
          };
        })
        .filter((x) => x.name && Number.isFinite(x.price) && x.price > 0);
    }

    const seen = new Set();
    const dedup = [];
    for (const r of mapped) {
      const key = `${r.name}|${r.price}|${r.url || ""}`;
      if (!seen.has(key)) {
