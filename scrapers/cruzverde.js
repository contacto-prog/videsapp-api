// scrapers/cruzverde.js
export const sourceId = "cruzverde";

/**
 * Scraper Cruz Verde (Chile) usando Intelligent Search API (VTEX)
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
    page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
    });

    const query = String(q || "").trim();
    if (!query) return [];

    const items = await page.evaluate(async (q) => {
      const endpoint = `https://www.cruzverde.cl/_v/api/intelligent-search/product_search/v1/?ft=${encodeURIComponent(q)}&_from=0&_to=40`;

      const res = await fetch(endpoint);
      if (!res.ok) return [];
      const data = await res.json();

      if (!data?.hits?.length) return [];

      const out = [];
      for (const hit of data.hits) {
        const name = hit?.productName || hit?.productTitle || "";
        const price = hit?.items?.[0]?.sellers?.[0]?.commertialOffer?.Price ?? null;
        const url = hit?.linkText
          ? `https://www.cruzverde.cl/${hit.linkText}/p`
          : null;
        if (!name || !Number.isFinite(price)) continue;
        out.push({
          store: "Cruz Verde",
          name,
          price: Math.round(price),
          url,
          stock: true,
        });
        if (out.length >= 60) break;
      }
      return out;
    }, query);

    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.error("[CruzVerde] scraper error:", err?.message || err);
    return [];
  } finally {
    try {
      await page?.close();
    } catch {}
    await browser.close().catch(() => {});
  }
}
