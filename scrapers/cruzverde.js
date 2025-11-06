// scrapers/cruzverde.js
export const sourceId = "cruzverde";

/**
 * Puedes forzar la zona vía:
 *  - options.inventoryId / options.inventoryZone
 *  - o variables de entorno: CV_INVENTORY_ID / CV_INVENTORY_ZONE
 */
export async function fetchCruzVerde(
  q,
  { puppeteer, headless = "new", executablePath, inventoryId, inventoryZone } = {}
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

    // 1) tocar la home para tener cookies/sesión
    await page.goto("https://www.cruzverde.cl/", { waitUntil: "domcontentloaded", timeout: 25000 }).catch(()=>{});

    const query = String(q || "").trim();
    if (!query) return [];

    // 2) lee override desde env/params (si no, la página intentará usar localStorage/cookies)
    const OV_INV  = process.env.CV_INVENTORY_ID   || inventoryId   || null;
    const OV_ZONE = process.env.CV_INVENTORY_ZONE || inventoryZone || null;

    const items = await page.evaluate(async (q, ovInv, ovZone) => {
      const lsGet = (k) => { try { return localStorage.getItem(k) || null; } catch { return null; } };
      const ckGet = (k) => { const m = document.cookie.match(new RegExp(`(?:^|; )${k}=([^;]+)`)); return m ? decodeURIComponent(m[1]) : null; };

      let inventoryId   = ovInv  || lsGet("inventoryId")   || ckGet("inventoryId");
      let inventoryZone = ovZone || lsGet("inventoryZone") || ckGet("inventoryZone");

      // último fallback duro (si no hay nada)
      if (!inventoryId || !inventoryZone) {
        inventoryId   = "Zonapañales1119";
        inventoryZone = "Zonapañales1119";
      }

      const base = "https://api.cruzverde.cl/product-service/products/search";
      const mkUrl = (params) => {
        const usp = new URLSearchParams({
          limit: "40",
          offset: "0",
          sort: "",
          q,
          isAndes: "true",
          ...params,
        });
        return `${base}?${usp.toString()}`;
      };

      const urls = [
        mkUrl({ inventoryId, inventoryZone }), // preferida (con zona)
        mkUrl({}),                             // sin zona, por si acaso
      ];

      const fetchJson = async (u) => {
        try {
          const r = await fetch(u, { credentials: "include" });
          if (!r.ok && r.status !== 304) return null;
          return await r.json();
        } catch { return null; }
      };

      const mapProducts = (data) => {
        const products = Array.isArray(data?.products) ? data.products : [];
        const out = [];
        for (const p of products) {
          const name  = p?.name || p?.productName || "";
          const price = (p?.price?.price ?? p?.price?.basePrice ?? null);
          const link  = p?.url ? `https://www.cruzverde.cl${p.url}` : null;
          if (!name || !Number.isFinite(price)) continue;
          out.push({
            store: "Cruz Verde",
            name,
            price: Math.round(Number(price)),
            url: link,
            img: p?.imageUrl || null,
            stock: (p?.stock ?? 1) > 0,
          });
          if (out.length >= 60) break;
        }
        return out;
      };

      for (const u of urls) {
        const j = await fetchJson(u);
        const rows = mapProducts(j);
        if (rows.length) return rows;
      }
      return [];
    }, query, OV_INV, OV_ZONE);

    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.error("[CruzVerde] scraper error:", err?.message || err);
    return [];
  } finally {
    try { await page?.close(); } catch {}
    await browser.close().catch(()=>{});
  }
}
