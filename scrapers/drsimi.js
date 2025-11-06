// scrapers/drsimi.js
import {
  safeGoto,
  tryDismissCookieBanners,
  autoScroll,
  normalize,
  parsePriceCLP,
  pickPriceFromHtml,
  pickCards,
} from "./utils.js";

export const sourceId = "drsimi";

/**
 * Scraper Dr. Simi (Chile)
 * Estrategia:
 *  1) Intentar páginas de búsqueda conocidas (Shopify/variantes).
 *  2) Extraer tarjetas con múltiples selectores de nombre/precio/link.
 *  3) Fallback: patrón CLP sobre innerText/HTML si los selectores fallan.
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
    page = await browser.newPage();

    // Rutas de búsqueda que suelen existir en Shopify / implementaciones personalizadas
    const searchUrls = [
      `https://www.drsimi.cl/search?q=${encodeURIComponent(q)}`,
      `https://www.drsimi.cl/pages/busqueda?q=${encodeURIComponent(q)}`,
      `https://www.drsimi.cl/?s=${encodeURIComponent(q)}`,
      `https://www.drsimi.cl/buscar?q=${encodeURIComponent(q)}`,
    ];

    const all = [];

    // Selectores amplios para múltiples themes (Shopify, custom, genéricos)
    const cardsSelectors = {
      cards: [
        // Shopify comunes:
        ".product-grid .grid__item",
        ".product-card",
        ".card-wrapper",
        ".product-item",
        "li.product",
        ".collection__product, .product-grid-item",
        // fallback genérico
        ".grid li, .grid .item, .products .product",
      ].join(","),
      name: [
        ".product-card__title",
        ".card__heading",
        ".product-item__title",
        ".product__title",
        ".product-title",
        ".product-card-title",
        "a[title]",
      ],
      price: [
        ".price-item--regular",
        ".price__regular",
        ".price .amount",
        ".price, .product-price, .price__current, .money",
        "[data-price], [itemprop='price'], [data-product-price]",
      ],
      link: [
        "a.product-card__link",
        ".card__heading a",
        "a.product-item__image-wrapper",
        "a[href*='/products/']",
        "a[href^='/']",
      ],
    };

    for (const url of searchUrls) {
      const ok = await safeGoto(page, url, 25000);
      if (!ok) continue;

      await tryDismissCookieBanners(page);
      await autoScroll(page, { steps: 8, delay: 250 });
      await page.waitForTimeout(800);

      // 1) Intento con pickCards (ya normaliza precio con parsePriceCLP/pickPriceFromHtml)
      let picked = await pickCards(page, cardsSelectors);
      let mapped = (picked || []).map((r) => ({
        store: "Dr. Simi",
        name: normalize(r.name),
        price: r.price,
        img: null,
        url: r.link || null,
        stock: true,
      }));

      // 2) Si quedó vacío, hacemos un fallback más agresivo por patrón
      if (!mapped.length) {
        const raw = await page.$$eval(
          cardsSelectors.cards,
          (nodes) =>
            nodes.map((card) => ({
              text: (card.innerText || card.textContent || "").trim(),
              html: card.outerHTML || "",
              name:
                (card.querySelector(".product-card__title") ||
                  card.querySelector(".card__heading") ||
                  card.querySelector(".product-item__title") ||
                  card.querySelector(".product__title") ||
                  card.querySelector(".product-title") ||
                  card.querySelector("a[title]"))?.textContent?.trim() || null,
              href:
                (card.querySelector("a.product-card__link") ||
                  card.querySelector(".card__heading a") ||
                  card.querySelector("a[href*='/products/']") ||
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
              store: "Dr. Simi",
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
      console.error("[Dr. Simi] scraper error:", e?.message || e);
    }
    return [];
  } finally {
    try { await page?.close(); } catch {}
    await browser.close();
  }
}
