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

    // 1) Ir a la página de búsqueda (misma ORIGEN)
    const searchUrl = `https://www.cruzverde.cl/search?query=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForSelector("body", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(800);

    // 2) Intento 1: Intelligent Search API (desde mismo origen)
    const apiItems = await page.evaluate(async (q) => {
      try {
        const url = `https://www.cruzverde.cl/_v/api/intelligent-search/product_search/v1/?ft=${encodeURIComponent(q)}&_from=0&_to=40`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return [];
        const data = await res.json();

        // Respuesta tipo { v, type: "product_search_result", hits: [...] }
        const hits = Array.isArray(data?.hits) ? data.hits : [];
        const out = [];
        for (const h of hits) {
          const name  = h?.productName || h?.productTitle || "";
          const price = h?.items?.[0]?.sellers?.[0]?.commertialOffer?.Price ?? null;
          const urlp  = h?.linkText ? `https://www.cruzverde.cl/${h.linkText}/p` : null;
          if (!name || !Number.isFinite(price)) continue;
          out.push({ store: "Cruz Verde", name, price: Math.round(price), url: urlp, stock: true });
          if (out.length >= 60) break;
        }
        return out;
      } catch { return []; }
    }, query);

    if (Array.isArray(apiItems) && apiItems.length) return apiItems;

    // 3) Intento 2: __STATE__ embebido en la página
    const stateItems = await page.evaluate(() => {
      try {
        const w = window;
        let state = null;
        if (w && w.__STATE__) state = w.__STATE__;
        if (!state) {
          const scripts = Array.from(document.querySelectorAll("script"));
          for (const s of scripts) {
            const t = s.textContent || "";
            if (t.includes("__STATE__")) {
              try { state = eval("(" + t + ")").__STATE__; } catch {}
              if (state) break;
            }
          }
        }
        if (!state) return [];

        const out = [];
        const asText = JSON.stringify(state);
        // Buscar pares nombre/precio dentro del estado
        const re = /"commertialOffer"\s*:\s*\{[^}]*"Price"\s*:\s*([0-9.]+)[^}]*\}[^}]*\}[^}]*"name"\s*:\s*"([^"]+)"/gi;
        let m;
        while ((m = re.exec(asText))) {
          const price = Math.round(Number(m[1]));
          const name  = m[2];
          if (name && Number.isFinite(price)) {
            out.push({ store: "Cruz Verde", name, price, url: null, stock: true });
          }
          if (out.length >= 60) break;
        }
        return out;
      } catch { return []; }
    });

    return Array.isArray(stateItems) ? stateItems : [];
  } catch (err) {
    console.error("[CruzVerde] scraper error:", err?.message || err);
    return [];
  } finally {
    try { await page?.close(); } catch {}
    await browser.close().catch(() => {});
  }
}
