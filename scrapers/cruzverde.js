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

    const dedupeItems = (items = []) => {
      const seen = new Set();
      const out = [];
      for (const it of items) {
        if (!it || !it.name || !Number.isFinite(it.price)) continue;
        const key = `${it.name}|${it.price}|${it.url || ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(it);
        }
        if (out.length >= 60) break;
      }
      return out;
    };

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
        return dedupeItems(sfcc);
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
@@ -116,139 +119,279 @@ export async function fetchCruzVerde(
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
            return dedupeItems(svc);
    }

    // 4) ÚLTIMO RECURSO: DOM
    const searchUrl = `https://www.cruzverde.cl/search?query=${encodeURIComponent(query)}`;
  const collectedFromResponses = [];
    const pendingResponses = new Set();
    const mapApiPayload = (payload) => {
      const take = [];
      if (!payload) return take;

      const pushItem = (raw) => {
        if (!raw) return;
        const name = normalize(raw.name || raw.productName || raw.title || "");
        const priceValue =
          raw.price ??
          raw.priceSale ??
          raw.finalPrice ??
          raw.salePrice ??
          raw.priceList ??
          (raw.prices &&
            (raw.prices["price-sale-cl"] ??
              raw.prices["price-list-cl"] ??
              raw.prices.price));

        const price = Number(priceValue);
        if (!name || !Number.isFinite(price)) return;

        const stockRaw =
          raw.stock ??
          raw.stockLevel ??
          raw.availability ??
          raw.available ??
          raw.isAvailable ??
          null;

        const asBool =
          typeof stockRaw === "number"
            ? stockRaw > 0
            : typeof stockRaw === "boolean"
            ? stockRaw
            : true;

        const link =
          raw.url ||
          raw.link ||
          raw.href ||
          (typeof raw.slug === "string" ? `/${raw.slug}` : null) ||
          null;

        take.push({
          store: "Cruz Verde",
          name,
          price: Math.round(price),
          url: typeof link === "string" ? link : null,
          stock: asBool,
        });
      };

      if (payload?.type === "product_search_result" && Array.isArray(payload?.hits)) {
        for (const hit of payload.hits) {
          const prices = hit?.prices || {};
          const price =
            Number(prices["price-sale-cl"] ?? prices["price-list-cl"] ?? hit?.price) ?? null;
          pushItem({
            name: hit?.productName,
            price,
            url: hit?.link,
            stock: hit?.stock,
          });
          if (take.length >= 60) break;
        }
      }

      const arr = Array.isArray(payload?.products)
        ? payload.products
        : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
        ? payload
        : [];

      for (const it of arr) {
        const price =
          it?.price?.sale ??
          it?.price?.list ??
          it?.finalPrice ??
          it?.salePrice ??
          it?.price ??
          (it?.prices &&
            (it.prices["price-sale-cl"] ??
              it.prices["price-list-cl"] ??
              it.prices.price));

        pushItem({
          name: it?.name || it?.productName,
          price,
          url: it?.url || it?.link,
          stock: it?.stock ?? it?.available ?? it?.availability,
        });
        if (take.length >= 60) break;
      }

      return take;
    };

    const responseHandler = (response) => {
      const url = response?.url?.() || "";
      if (!/product-service\/products\/search|dw\/shop\//i.test(url)) return;
      const work = (async () => {
        try {
          const json = await response.json();
          const mapped = mapApiPayload(json);
          if (mapped.length) {
            collectedFromResponses.push(...mapped);
          }
        } catch {}
      })();
      pendingResponses.add(work);
      work.finally(() => pendingResponses.delete(work));
    };

    page.on("response", responseHandler);

    try {
      await safeGoto(page, searchUrl, 30000);
      await tryDismissCookieBanners(page).catch(() => {});
      await page.waitForTimeout(1200);
      await autoScroll(page, { steps: 8, delay: 200 });
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

      if (pendingResponses.size) {
        await Promise.allSettled([...pendingResponses]);
      } else {
        await page.waitForTimeout(800);
      }

      if (collectedFromResponses.length) {
        const apiDedup = dedupeItems(collectedFromResponses);
        if (apiDedup.length) return apiDedup;
      }
    } finally {
      try {
        page.off("response", responseHandler);
      } catch {}
    }

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
    return dedupeItems(mapped);
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
               
