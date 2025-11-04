export async function searchCruzVerde(query, { limit = 10, debug = false, baseUrl = "https://www.cruzverde.cl" } = {}) {
  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.launch({ headless: true }); // en Render: añadir args no-sandbox
  const page = await browser.newPage();
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}`;
  const out = [];
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Espera a que el frontend cargue productos (ajustaremos selector tras /search2?debug=1)
    await page.waitForTimeout(1500);
    const html = await page.content();

    // TODO: cuando veamos el HTML real en debug, pondremos selectores precisos.
    // De momento devolvemos vacío para que el agregador registre el sitio como "reachable".
    if (debug) return { items: out, debug: { url, note: "Puppeteer OK; faltan selectores" } };
    return out.slice(0, limit);
  } finally {
    await browser.close();
  }
}
