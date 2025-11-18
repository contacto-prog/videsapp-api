import {
  safeGoto,
  tryDismissCookieBanners,
  autoScroll,
  normalize,
  parsePriceCLP,
  pickPriceFromHtml,
  setPageDefaults,
} from "./utils.js";

export const sourceId = "drsimi";

/**
 * Scraper Dr. Simi
 * @param {string} q - término de búsqueda
 * @param {{ puppeteer?: any, headless?: any, executablePath?: string }} opts
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
    await setPageDefaults(page);

    const url = `https://www.drsimi.cl/search?q=${encodeURIComponent(q)}`;
    const ok = await safeGoto(page, url, 25000);
    if (!ok) return [];

    await tryDismissCookieBanners(page);
    await page.waitForTimeout(1500);
    await autoScroll(page, { steps: 8, delay: 250 });
    await page.waitForTimeout(800);

    const raw = await page.evaluate(() => {
      const cards = document.querySelectorAll(
        ".product-card, .ProductCard, .product, .product-item"
      );
      const out = [];
      cards.forEach((card) => {
        const titleEl =
          card.querySelector("h2, .product-title, .product-name") ||
          card.querySelector("a[title]");

        const linkEl =
          card.querySelector("a[href*='/']") ||
          card.querySelector("a.product-link");

        const imgEl = card.querySelector("img");

        out.push({
          title: titleEl?.textContent?.trim() || null,
          href: linkEl?.href || null,
          img: imgEl?.src || null,
          text: (card.innerText || card.textContent || "").trim(),
          html: card.outerHTML || "",
        });
      });
      return out;
    });

    const mapped = raw
      .map((it) => {
        const name = normalize(it.title);
        let price = parsePriceCLP(it.text) ?? pickPriceFromHtml(it.html);

        if (price && (price < 100 || price > 500000)) price = null;

        return {
          store: "Dr. Simi",
          name,
          price: price ?? null,
          img: it.img || null,
          url: it.href || null,
          stock: price != null,
        };
      })
      .filter((x) => x.name && Number.isFinite(x.price) && x.price > 0);

    const seen = new Set();
    const dedup = [];
    for (const r of mapped) {
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
      console.error("[DrSimi] scraper error", e);
    }
    return [];
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}
