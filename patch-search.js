const fs = require('fs');

let s = fs.readFileSync('server.js','utf8');

const rx = /app\.get\("\/search"[\s\S]*?\}\);\n/;

const NEW = `app.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ ok:false, error:"q_required" });
    const debug = req.query.debug === '1';
    const data = await federatedSearchTop1(q, { debug });
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok:false, error: String(err?.message || err) });
  }
});\n`;

if (!rx.test(s)) {
  // Si no existe handler /search, lo insertamos ANTES del middleware 404
  const before404 = /app\.use\(\(req,\s*res\)\s*=>\s*\{\s*res\.status\(404\)/;
  if (!before404.test(s)) {
    console.error('No encontré la ruta /search ni el bloque 404 para insertar. Revisa server.js');
    process.exit(1);
  }
  s = s.replace(before404, NEW + '\n' + s.match(before404)[0]);
  console.log('No había /search, lo inserté antes del 404.');
} else {
  s = s.replace(rx, NEW);
  console.log('Actualicé la ruta /search para soportar ?debug=1');
}

fs.writeFileSync('server.js', s);
