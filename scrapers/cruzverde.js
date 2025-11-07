// scrapers/cruzverde.js
import {
  tryDismissCookieBanners,
  autoScroll,
  pickCards,
  normalize,
  pickPriceFromText,
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
    await page.setExtraHTTPHeaders({ "Accept-Language": "es-CL,es;q=0.9,en;q=0.8" });
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    const searchUrl = `https://www.cruzverde.cl/search?query=${encodeURIComponent(query)}`;

    const items = [];

    // Captura XHR de SFCC (product_search_result)
    page.on("response", async (res) => {
      try {
        const url = res.url();
        if (!res.ok()) return;

        // Candidatos: wrapper propio y llamadas SFCC
        const looksLikeSearch =
          url.includes("/product-service/products/search") ||
          url.includes("/dw/shop/") ||
          url.includes("product_search");

        if (!looksLikeSearch) return;

        const data = await res
          .json()
          .catch(() => null);

        if (!data || data.type !== "product_search_result" || !Array.isArray(data.hits)) {
          return;
        }

        for (const h of data.hits) {
          const name = normalize(h?.productName || "");
          const prices = h?.prices || {};
          const price =
            Number(prices["price-sale-cl"]) ||
            Number(prices["price-list-cl"]) ||
            null;

          const urlOut =
            typeof h?.link === "string" && h.link ? h.link : null;

          if (name && Number.isFinite(price)) {
            items.push({
              store: "Cruz Verde",
              name,
              price: Math.round(price),
              url: urlOut,
              stock: typeof h?.stock === "number" ? h.stock > 0 : true,
            });
          }
          if (items.length >= 60) break;
        }
      } catch {}
    });

    // Ir a resultados y dar tiempo a que caigan los XHR
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await tryDismissCookieBanners(page).catch(() => {});
    await autoScroll(page, { steps: 8, delay: 250 });

    // Pequeña espera para que se resuelvan los XHR
    const t0 = Date.now();
    while (Date.now() - t0 < 5000 && items.length === 0) {
      await page.waitForTimeout(200);
    }
    if (items.length) {
      // Dedup por (name|price|url)
      const seen = new Set();
      const out = [];
      for (const it of items) {
        const k = `${it.name}|${it.price}|${it.url || ""}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push(it);
        }
        if (out.length >= 60) break;
      }
      return out;
    }

    // === Fallback DOM (por si el XHR no se pudo leer) ===
    const cardsSelectors = {
      cards: [
        ".product-card",
        ".vtex-search-result-3-x-galleryItem",
        ".vtex-product-summary-2-x-container",
        "li.product",
        ".shelf__item",
      ].join(","),
      name: [
        ".product-card__title",
        ".vtex-product-summary-2-x-productName",
        ".vtex-product-summary-2-x-productBrand",
        ".product-item-link",
        "a[title]",
      ],
      price: [
        ".product-price",
        ".price",
        ".best-price",
        ".vtex-product-price-1-x-sellingPriceValue",
        ".vtex-product-price-1-x-currencyInteger",
      ],
      link: [
        "a.product-item-link",
        "a[href*='/p']",
        "a[href^='/']",
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
                card.querySelector("a[title]"))?.textContent?.trim() || null,
            href:
              (card.querySelector("a.product-item-link") ||
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
        seen.add(key);
        dedup.push(r);
      }
      if (dedup.length >= 60) break;
    }

    return dedup;
  } catch (e) {
    if (process.env.DEBUG_PRICES) {
      console.error("[CruzVerde] scraper error:", e?.message || e);
    }
    return [];
  } finally {
    try { await page?.close(); } catch {}
    await browser.close().catch(() => {});
  }
}
