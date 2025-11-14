// scrapers/ahumada.js
import {
  safeGoto,
  tryDismissCookieBanners,
  autoScroll,
  normalize,
  parsePriceCLP,
  pickPriceFromHtml,
  setPageDefaults,
} from "./utils.js";

export const sourceId = "ahumada";

/**
 * Scraper Farmacias Ahumada
 * @param {string} q - término de búsqueda (ej. "paracetamol 500")
 * @param {{ puppeteer?: any, headless?: any, executablePath?: string }} opts
 * @returns {Promise<Array<{store:string,name:string,price:number,img?:string,url?:string,stock:boolean}>>}
 */
export async function fetchAhumada(
  q,
  { puppeteer, headless = "new", executablePath } = {}
) {
  if (!puppeteer) throw new Error("fetchAhumada requiere puppeteer en opts");

  const browser = await puppeteer.launch({
    headless,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let page;
  try {
    page = await browser.newPage();
    await setPageDefaults(page);

    const url = `https://www.farmaciasahumada.cl/catalogsearch/result/?q=${encodeURIComponent(
      q
    )}`;

    const ok = await safeGoto(page, url, 25000);
    if (!ok) return [];

    await tryDismissCookieBanners(page);
    await page.waitForTimeout(1500);
    await autoScroll(page, { steps: 8, delay: 250 });
    await page.waitForTimeout(800); // deja cargar precios/lazy

    const raw = await page.evaluate(() => {
      const sels = [
        ".product-item",
        ".product-item-info",
        "li.product",
        ".product-card",
        ".item.product",
      ];
      const cards = document.querySelectorAll(sels.join(","));
      const out = [];
      cards.forEach((card) => {
        const titleEl =
          card.querySelector(".product-item-link") ||
          card.querySelector(".product-item-name a") ||
          card.querySelector("a.product-item-link") ||
          card.querySelector("a[title]");

        const linkEl =
          card.querySelector("a.product-item-link") ||
          card.querySelector("a[href*='/']");

        const imgEl =
          card.querySelector("img") || card.querySelector("source, picture img");

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
        let price =
          parsePriceCLP(it.text) ??
          // fallback: escanea HTML
          pickPriceFromHtml(it.html);

        if (price && (price < 100 || price > 500000)) price = null;

        return {
          store: "Ahumada",
          name,
          price: price ?? null,
          img: it.img || null,
          url: it.href || null,
          stock: true,
        };
      })
      .filter((x) => x.name && Number.isFinite(x.price) && x.price > 0);

    // dedupe por name+price y limita a 40
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
      console.error("[Ahumada] scraper error", e);
    }
    return [];
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}
