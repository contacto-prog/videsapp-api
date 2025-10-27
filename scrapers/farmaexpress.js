export async function searchFarmaexpress(query, { limit = 10, debug = false, baseUrl = "https://farmex.cl" } = {}) {
  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.launch({ headless: true }); // en Render: args no-sandbox
  const page = await browser.newPage();
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);
    const html = await page.content();
    // TODO: ajustar selectores al ver HTML con debug
    return debug ? { items: [], debug: { url, note: "Puppeteer OK; Shopify challenge superado, faltan selectores" } } : [];
  } finally {
    await browser.close();
  }
}
