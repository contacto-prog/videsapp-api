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
    await page.setExtraHTTPHeaders({
      "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
    });

    // 1) Tocar home para cargar cookies / localStorage (zona)
    await page.goto("https://www.cruzverde.cl/", {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    }).catch(() => {});

    const query = String(q || "").trim();
    if (!query) return [];

    const out = await page.evaluate(async (q) => {
      const pick = (obj, ...paths) => {
        for (const p of paths) {
          try {
            const v = p.split(".").reduce((a, k) => (a ? a[k] : undefined), obj);
            if (v !== undefined && v !== null) return v;
          } catch {}
        }
        return undefined;
      };

      // Leer zona de inventario desde localStorage o cookies
      const ls = window.localStorage;
      const fromLS = (k) => { try { return ls.getItem(k) || null; } catch { return null; } };
      const fromCookie = (k) => {
        const m = document.cookie.match(new RegExp(`(?:^|; )${k}=([^;]+)`));
        return m ? decodeURIComponent(m[1]) : null;
      };

      const inventoryId   = fromLS("inventoryId")   || fromCookie("inventoryId");
      const inventoryZone = fromLS("inventoryZone") || fromCookie("inventoryZone");

      // Construir intents de URL (con y sin inventario)
      const base = "https://api.cruzverde.cl/product-service/products/search";
      const mk = (params) => {
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

      const tries = [];
      if (inventoryId && inventoryZone) {
        tries.push(mk({ inventoryId, inventoryZone }));
      }
      // variantes sin inventario (por si la zona no está seteada aún)
      tries.push(mk({}));

      // Fallback VTEX directo, por si la API nueva no responde
      const vtexBases = [
        `https://www.cruzverde.cl/_v/api/intelligent-search/product_search/v1/?ft=${encodeURIComponent(q)}&_from=0&_to=40`,
        `https://www.cruzverde.cl/api/catalog_system/pub/products/search/?ft=${encodeURIComponent(q)}&_from=0&_to=40`,
        `https://www.cruzverde.cl/api/catalog_system/pub/products/search/${encodeURIComponent(q)}?_from=0&_to=40`,
      ];

      const fetchJson = async (url) => {
        try {
          const r = await fetch(url, { credentials: "include" });
          if (!r.ok && r.status !== 304) return null;
          const j = await r.json();
          return j;
        } catch { return null; }
      };

      const mapApi = (data) => {
        const products =
          Array.isArray(data?.products) ? data.products :
          Array.isArray(data?.data?.products) ? data.data.products :
          Array.isArray(data) ? data : [];

        const rows = [];
        for (const p of products) {
          const name  = p?.name || p?.productName || p?.productDisplayName || "";
          const price =
            pick(p, "price.price", "price.basePrice", "prices.0.price", "commertialOffer.Price", "Price") ?? null;
          let link = p?.url
            ? (p.url.startsWith("http") ? p.url : `https://www.cruzverde.cl${p.url}`)
            : (p?.linkText ? `https://www.cruzverde.cl/${p.linkText}/p` : null);
          if (!name || !Number.isFinite(price)) continue;
          rows.push({
            store: "Cruz Verde",
            name,
            price: Math.round(Number(price)),
            url: link || null,
            img: p?.imageUrl || null,
            stock: (p?.stock ?? p?.availableQuantity ?? 1) > 0,
          });
          if (rows.length >= 60) break;
        }
        return rows;
      };

      // 2) API nueva (con inventario primero)
      for (const u of tries) {
        const j = await fetchJson(u);
        const rows = mapApi(j);
        if (rows.length) return rows;
      }

      // 3) Fallback VTEX
      for (const u of vtexBases) {
        const j = await fetchJson(u);
        const rows = mapApi(j);
        if (rows.length) return rows;
      }

      return [];
    }, query);

    return Array.isArray(out) ? out : [];
  } catch (err) {
    console.error("[CruzVerde] scraper error:", err?.message || err);
    return [];
  } finally {
    try { await page?.close(); } catch {}
    await browser.close().catch(() => {});
  }
}
