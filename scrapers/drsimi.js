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

export async function fetchDrSimi(q, { puppeteer, headless = "new", executablePath } = {}) {
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
    await autoScroll(page);

    const raw = await page.evaluate(() => {
      const cards = document.querySelectorAll(".product-card, .ProductCard");
      const out = [];
      cards.forEach(card => {
        const title = card.querySelector("h2, .product-title")?.textContent?.trim() ?? null;
        const priceText = card.innerText ?? "";
        const img = card.querySelector("img")?.src ?? null;
        const link = card.querySelector("a")?.href ?? null;

        out.push({
          title,
          html: card.outerHTML,
          text: priceText,
          img,
          link,
        });
      });
      return out;
    });

    const mapped = raw
      .map(it => {
        const name = normalize(it.title);
        const price = parsePriceCLP(it.text) ?? pickPriceFromHtml(it.html);

        return {
          store: "Dr. Simi",
          name,
          price: price || null,
          img: it.img,
          url: it.link,
          stock: price != null,
        };
      })
      .filter(x => x.name && x.price);

    return mapped.slice(0, 40);
  } catch (e) {
    console.error("[DrSimi] scraper error", e);
    return [];
  } finally {
    try { await browser.close(); } catch {}
  }
}
