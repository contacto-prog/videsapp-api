const fs = require('fs');

let s = fs.readFileSync('server.js','utf8');

// A) Asegurar import de node-fetch una sola vez, junto a los demás imports
if (!s.includes('from "node-fetch"') && !s.includes("from 'node-fetch'")) {
  // Inserta el import de fetch después del último import existente
  const lines = s.split('\n');
  let lastImportIdx = -1;
  for (let i=0;i<lines.length;i++){
    if (/^\s*import\s.+from\s+['"].+['"]\s*;?\s*$/.test(lines[i])) lastImportIdx = i;
  }
  lines.splice(lastImportIdx+1, 0, 'import fetch from "node-fetch";');
  s = lines.join('\n');
}

// B) Bloque de rutas de diagnóstico (fetch, puppeteer, y /search2 debug forzado)
const DIAG_BLOCK =
`// ====== DIAGNÓSTICO RÁPIDO ======
app.get("/diag/fetch", async (req, res) => {
  try {
    const url = String(req.query.url || "");
    if (!url) return res.status(400).json({ ok:false, error:"url_required" });
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36",
        "Accept-Language": "es-CL,es;q=0.9"
      }
    });
    const text = await r.text();
    res.json({ ok: true, status: r.status, length: text.length, snippet: text.slice(0, 500) });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

app.get("/diag/puppeteer", async (req, res) => {
  try {
    const url = String(req.query.url || "");
    if (!url) return res.status(400).json({ ok:false, error:"url_required" });
    const puppeteer = (await import("puppeteer")).default;
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"]
    });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language":"es-CL,es;q=0.9" });
    await page.goto(url, { waitUntil:"networkidle2", timeout: 60000 });
    const title = await page.title();
    const bodyText = await page.evaluate(()=>document.body?.innerText?.slice(0,1000) || "");
    await browser.close();
    res.json({ ok:true, title, hasBody: !!bodyText, bodySnippet: bodyText.slice(0,200) });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

app.get("/search2", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ ok:false, error:"q_required" });
    const { federatedSearchTop1 } = await import("./scrapers/searchFederated.js");
    const data = await federatedSearchTop1(q, { debug: true });
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});
`;

// C) Inserta el bloque de diagnóstico justo ANTES del 404
const notFoundRx = /app\.use\(\(req,\s*res\)\s*=>\s*\{\s*res\.status\(404\)/;
if (!notFoundRx.test(s)) {
  console.error("No encontré el middleware 404 para insertar antes. Revisa server.js");
  process.exit(1);
}

// Si ya hay /diag/fetch definido, no duplica nada
if (!s.includes('app.get("/diag/fetch"')) {
  s = s.replace(notFoundRx, DIAG_BLOCK + '\n' + s.match(notFoundRx)[0]);
}

fs.writeFileSync('server.js', s);
console.log("✅ Rutas /diag/* y /search2 insertadas antes del 404.");
