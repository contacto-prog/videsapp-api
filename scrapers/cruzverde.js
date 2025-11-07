// scrapers/cruzverde.js
export const sourceId = "cruzverde";

export async function fetchCruzVerde(
  q,
  { puppeteer, headless = "new", executablePath } = {}
) {
  if (!puppeteer) throw new Error("fetchCruzVerde requiere puppeteer en opts");

  const browser = await puppeteer.launch({
    headless,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || executablePath,
    args: ["--no-sandbox","--disable-setuid-sandbox"],
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

    // Ir a la página para tener cookies/origen correcto (CORS)
    await page.goto(`https://www.cruzverde.cl/search?query=${encodeURIComponent(query)}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    const items = await page.evaluate(async (qStr) => {
      const url = `https://www.cruzverde.cl/s/Chile/dw/shop/v19_1/product_search?q=${encodeURIComponent(qStr)}&start=0&count=24`;
      try {
        const r = await fetch(url, { credentials: "include" });
        if (!r.ok) return [];
        const j = await r.json();
        if (!j || !Array.isArray(j.hits)) return [];
        const out = [];
        for (const h of j.hits) {
          const name = (h?.productName || "").trim();
          const price = Number(h?.prices?.["price-sale-cl"] ?? h?.prices?.["price-list-cl"]);
          const urlPdp = typeof h?.link === "string" ? h.link : null;
          if (name && Number.isFinite(price) && price > 0) {
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
        // de-dup
        const seen = new Set();
        return out.filter(it => {
          const k = `${it.name}|${it.price}|${it.url||""}`;
          if (seen.has(k)) return false; seen.add(k); return true;
        });
      } catch {
        return [];
      }
    }, query);

    return items;
  } catch {
    return [];
  } finally {
    try { await page?.close(); } catch {}
    await browser.close().catch(() => {});
  }
}
