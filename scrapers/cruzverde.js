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
    page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "es-CL,es;q=0.9,en;q=0.8" });

    const query = String(q || "").trim();
    if (!query) return [];

    const searchUrl = `https://www.cruzverde.cl/search?query=${encodeURIComponent(query)}`;

    // --- 1) Escuchar la respuesta XHR de Intelligent Search mientras navegamos ---
    const collected = [];
    const mapHits = (data) => {
      const hits = Array.isArray(data?.hits) ? data.hits : [];
      for (const h of hits) {
        const name =
          h?.productName || h?.productTitle || h?.productNameWithTag || "";
        const price =
          h?.items?.[0]?.sellers?.[0]?.commertialOffer?.Price ?? null;
        const url = h?.linkText
          ? `https://www.cruzverde.cl/${h.linkText}/p`
          : null;
        if (name && Number.isFinite(price)) {
          collected.push({
            store: "Cruz Verde",
            name,
            price: Math.round(price),
            url,
            stock: true,
          });
        }
        if (collected.length >= 60) break;
      }
    };

    page.on("response", async (res) => {
      try {
        const url = res.url();
        if (
          url.includes("/_v/api/intelligent-search/product_search") &&
          res.ok()
        ) {
          const json = await res.json().catch(() => null);
          if (json) mapHits(json);
        }
      } catch {}
    });

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await tryDismissCookieBanners(page).catch(() => {});
    await autoScroll(page, { steps: 10, delay: 250 });

    // Espera hasta que llegue el XHR (máx 6s) con polling corto
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && collected.length === 0) {
      await page.waitForTimeout(250);
    }
    if (collected.length) return collected;

    // --- 2) Fallback DOM (si el XHR no se capturó por cualquier razón) ---
    const cardsSelectors = {
      cards: [
        ".vtex-search-result-3-x-galleryItem",
        ".vtex-product-summary-2-x-container",
        ".product-item",
        ".product-card",
        "li.product",
        ".shelf__item",
      ].join(","),
      name: [
        ".vtex-product-summary-2-x-productBrand",
        ".vtex-product-summary-2-x-productName",
        ".product-item-link",
        ".product-card__title",
        "a[title]",
      ],
      price: [
        ".vtex-product-price-1-x-sellingPriceValue",
        ".vtex-product-price-1-x-currencyInteger",
        ".best-price",
        ".price",
        ".product-price",
      ],
      link: [
        "a.vtex-product-summary-2-x-clearLink",
        "a.product-item-link",
        "a[href*='/p']",
        "a[href^='/']",
      ],
    };

    // 2.a) Intento con selectores (pickCards ya intenta normalizar)
    let picked = await pickCards(page, cardsSelectors);
    let mapped = (picked || []).map((r) => ({
      store: "Cruz Verde",
      name: normalize(r.name),
      price: r.price,
      url: r.link || null,
      stock: true,
    }));

    // 2.b) Fallback agresivo: leer innerText/HTML y parsear precio a mano
    if (!mapped.length) {
      const raw = await page
        .$$eval(
          cardsSelectors.cards,
          (nodes) =>
            nodes.map((card) => ({
              text: (card.innerText || card.textContent || "").trim(),
              html: card.outerHTML || "",
              name:
                (card.querySelector(".vtex-product-summary-2-x-productBrand") ||
                  card.querySelector(".vtex-product-summary-2-x-productName") ||
                  card.querySelector(".product-item-link") ||
                  card.querySelector(".product-card__title") ||
                  card.querySelector("a[title]"))?.textContent?.trim() || null,
              href:
                (card.querySelector("a.vtex-product-summary-2-x-clearLink") ||
                  card.querySelector("a.product-item-link") ||
                  card.querySelector("a[href*='/p']") ||
                  card.querySelector("a[href^='/']"))?.href || null,
            })) || []
        )
        .catch(() => []);

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

    // De-dup y límite
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
  } catch (err) {
    console.error("[CruzVerde] scraper error:", err?.message || err);
    return [];
  } finally {
    try { await page?.close(); } catch {}
    await browser.close().catch(() => {});
  }
}
