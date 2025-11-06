// scrapers/cruzverde.js
export const sourceId = "cruzverde";

/**
 * Scraper directo a la API pública de Cruz Verde (api.cruzverde.cl)
 * Esta ruta devuelve JSON con precios, nombres e IDs de productos.
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

    // Tocamos la home solo para establecer cookies (evita bloqueos CORS)
    await page.goto("https://www.cruzverde.cl/", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    }).catch(() => {});

    const query = String(q || "").trim();
    if (!query) return [];

    const results = await page.evaluate(async (q) => {
      const endpoint = `https://api.cruzverde.cl/product-service/products/search?limit=40&offset=0&sort=&q=${encodeURIComponent(q)}&isAndes=true`;

      try {
        const res = await fetch(endpoint, { credentials: "include" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();

        if (!Array.isArray(data?.products)) return [];

        const out = [];
        for (const p of data.products) {
          const name = p?.name || p?.productName || "";
          const price = p?.price?.price || p?.price?.basePrice || null;
          const link = p?.url ? `https://www.cruzverde.cl${p.url}` : null;
          if (!name || !Number.isFinite(price)) continue;
          out.push({
            store: "Cruz Verde",
            name,
            price: Math.round(price),
            url: link,
            img: p?.imageUrl || null,
            stock: p?.stock > 0,
          });
        }
        return out;
      } catch (err) {
        console.error("CV API error:", err.message);
        return [];
      }
    }, query);

    return Array.isArray(results) ? results : [];
  } catch (err) {
    console.error("[CruzVerde] scraper error:", err?.message || err);
    return [];
  } finally {
    try { await page?.close(); } catch {}
    await browser.close().catch(() => {});
  }
}
