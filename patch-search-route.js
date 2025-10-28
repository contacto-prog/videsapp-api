import fs from "fs";
const file = "server.js";
let code = fs.readFileSync(file, "utf8");

// Normaliza handler /search para pasar params correctamente
code = code.replace(
  /app\.get\(['"]\/search['"],\s*async\s*\(req,\s*res\)\s*=>\s*{[\s\S]*?}\);/m,
  `app.get('/search', async (req, res) => {
    try {
      const q = (req.query.q || '').toString();
      const lat = req.query.lat ? Number(req.query.lat) : null;
      const lng = req.query.lng ? Number(req.query.lng) : null;
      const debug = req.query.debug === '1' || req.query.debug === 'true';
      const limitPerStore = req.query.limit ? Number(req.query.limit) : 10;
      const { federatedSearchTop1 } = await import('./scrapers/searchFederated.js');
      const out = await federatedSearchTop1(q, { limitPerStore, lat, lng, debug });
      res.json(out);
    } catch (err) {
      res.status(500).json({ ok:false, error: String(err?.message || err) });
    }
  });`
);

// Agrega /search2 con debug forzado
if (!code.includes("app.get('/search2'")) {
  code = code.replace(
    /app\.use\([\s\S]*?404[\s\S]*?\);/m,
    `app.get('/search2', async (req, res) => {
      try {
        const q = (req.query.q || '').toString();
        const lat = req.query.lat ? Number(req.query.lat) : null;
        const lng = req.query.lng ? Number(req.query.lng) : null;
        const limitPerStore = req.query.limit ? Number(req.query.limit) : 10;
        const { federatedSearchTop1 } = await import('./scrapers/searchFederated.js');
        const out = await federatedSearchTop1(q, { limitPerStore, lat, lng, debug: true });
        res.json(out);
      } catch (err) {
        res.status(500).json({ ok:false, error: String(err?.message || err) });
      }
    });

$&`
  );
}

fs.writeFileSync(file, code);
console.log("✅ server.js actualizado: /search pasa debug/lat/lng y se añadió /search2 (debug).");
