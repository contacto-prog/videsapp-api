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

    // 1) Ir al sitio (CORS/cookies) y dar chance a banners
    await page.goto("https://www.cruzverde.cl/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
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
            }
            if (out.length >= 60) break;
          }
          return out;
        }
        return null;
      } catch {
        return null;
      }
    }, query);

    if (Array.isArray(sfcc) && sfcc.length) {
      // de-dup
      const seen = new Set();
      const out = [];
      for (const it of sfcc) {
        const k = `${it.name}|${it.price}|${it.url || ""}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push(it);
        }
        if (out.length >= 60) break;
      }
      return out;
    }

    // 3) SEGUNDO INTENTO: API interna product-service (por si SFCC falla)
    const svc = await page.evaluate(async (qStr) => {
      // Tomar inventario si existe en localStorage
      let inventoryId = null, inventoryZone = null;
      try {
        inventoryId = localStorage.getItem("inventoryId") || null;
        inventoryZone = localStorage.getItem("inventoryZone") || null;
      } catch {}
      const params = new URLSearchParams({
        limit: "24",
        offset: "0",
        sort: "",
        q: qStr,
        isAndes: "true",
      });
      if (inventoryId)  params.set("inventoryId",  inventoryId);
      if (inventoryZone) params.set("inventoryZone", inventoryZone);
      const url = `https://api.cruzverde.cl/product-service/products/search?${params.toString()}`;

      try {
        const r = await fetch(url, { credentials: "include" });
        if (!r.ok) return null;
        const j = await r.json().catch(() => null);
        // No conocemos el shape exacto aquí; intentamos mapping flexible
        const take = [];
        const arr = Array.isArray(j?.products) ? j.products
                  : Array.isArray(j?.items)    ? j.items
                  : Array.isArray(j)           ? j
                  : [];
        for (const it of arr) {
          const name = (it?.name || it?.productName || "").trim();
          const price =
            Number(it?.price?.sale ?? it?.price?.list ?? it?.finalPrice ?? it?.salePrice ?? it?.price) ||
            Number(it?.prices?.["price-sale-cl"] ?? it?.prices?.["price-list-cl"]) || null;
          const urlPdp = it?.url || it?.link || null;
          if (name && Number.isFinite(price)) {
            take.push({
              store: "Cruz Verde",
              name,
              price: Math.round(price),
              url: urlPdp,
              stock: typeof it?.stock === "number" ? it.stock > 0 : true,
            });
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
    await tryDismissCookieBanners(page).catch(() => {});
    await autoScroll(page, { steps: 8, delay: 200 });

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
