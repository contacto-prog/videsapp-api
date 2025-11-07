// scrapers/cruzverde.js
export const sourceId = "cruzverde";

/**
 * Scraper Cruz Verde (Chile) – usando SFCC (Demandware) en beta.cruzverde.cl
 * Estrategia:
 *  - Ir a /search?query=... en beta.cruzverde.cl para obtener cookies/origen.
 *  - Desde page.evaluate() hacer fetch a /s/Chile/dw/shop/v19_1/product_search.
 *  - Mapear hits -> { store, name, price, url, stock }.
 */
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
    await page.setExtraHTTPHeaders({
      "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
    });
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // 1) Entramos al host correcto (beta) para tener cookies y origen
    const searchUrl = `https://beta.cruzverde.cl/search?query=${encodeURIComponent(
      query
    )}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

    // 2) Llamamos al SFCC abierto desde el mismo origen
    const items = await page.evaluate(async (qStr) => {
      const api = `https://beta.cruzverde.cl/s/Chile/dw/shop/v19_1/product_search?q=${encodeURIComponent(
        qStr
      )}&start=0&count=48`;

      try {
        const r = await fetch(api, { credentials: "include" });
        if (!r.ok) return [];
        const j = await r.json();
        if (!j || !Array.isArray(j.hits)) return [];

        const out = [];
        for (const h of j.hits) {
          const name = (h?.productName || "").trim();
          const rawPrice =
            h?.prices?.["price-sale-cl"] ?? h?.prices?.["price-list-cl"] ?? null;
          const price = Number(rawPrice);
          const url = typeof h?.link === "string" ? h.link : null;
          const stock =
            typeof h?.stock === "number" ? h.stock > 0 : true; // si no viene, asumimos stock true

          if (name && Number.isFinite(price) && price > 0) {
            out.push({
              store: "Cruz Verde",
              name,
              price: Math.round(price),
              url,
              stock,
            });
          }
          if (out.length >= 60) break;
        }

        // de-dup por (name|price|url)
        const seen = new Set();
        return out.filter((it) => {
          const k = `${it.name}|${it.price}|${it.url || ""}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      } catch (e) {
        return [];
      }
    }, query);

    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  } finally {
    try { await page?.close(); } catch {}
    await browser.close().catch(() => {});
  }
}
