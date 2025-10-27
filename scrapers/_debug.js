// scrapers/_debug.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function launchBrowser(puppeteer) {
  const headful = process.env.HEADFUL === '1';
  return puppeteer.launch({
    headless: headful ? false : 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--lang=es-CL,es;q=0.9,en;q=0.8',
      '--window-size=1280,900',
      '--disable-blink-features=AutomationControlled'
    ]
  });
}

export async function prepPage(page) {
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.emulateTimezone('America/Santiago');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8' });
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  );

  // Opcional: evita ser detectado
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
}

export async function dump(page, source, step = 'initial') {
  if (!process.env.DUMP) return;
  const dir = path.join(__dirname, '..', '.scrape-dumps', source);
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(dir, `${ts}_${step}`);
  try { await page.screenshot({ path: `${base}.png`, fullPage: true }); } catch {}
  try {
    const html = await page.content();
    fs.writeFileSync(`${base}.html`, html, 'utf8');
  } catch {}
}
