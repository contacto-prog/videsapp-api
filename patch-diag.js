import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverFile = path.join(__dirname, "server.js");

let code = fs.readFileSync(serverFile, "utf8");

if (!code.includes("app.get('/diag/fetch'")) {
  code = code.replace(
    /app\.use\(.*404.*\)/s,
    `
app.get('/diag/fetch', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');
  try {
    const r = await fetch(url);
    const text = await r.text();
    res.type('text/plain').send(text.slice(0, 1000));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/diag/puppeteer', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { timeout: 30000 });
    const html = await page.content();
    res.type('text/plain').send(html.slice(0, 1000));
  } catch (err) {
    res.status(500).send(err.message);
  } finally {
    await browser.close();
  }
});

$&`
  );

  fs.writeFileSync(serverFile, code);
  console.log("✅ server.js parcheado con /diag/fetch y /diag/puppeteer antes del 404");
} else {
  console.log("ℹ️ Ya existen las rutas /diag en server.js");
}
