import express from 'express';
import cors from 'cors';
import { scrapePrices } from './scrapers/index.js';

const app = express();
app.use(cors());
app.use(express.json());

// Healthcheck
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'videsapp-api', ts: new Date().toISOString() });
});

// Root (opcional)
app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'videsapp-api' });
});

app.get('/prices', async (req, res) => {
  try {
    const product = String(req.query.product || '').trim();
    if (!product) return res.status(400).json({ error: 'Parámetro product requerido' });

    if (process.env.ENABLE_SCRAPER !== 'true') {
      return res.json({
        product, averagePrice: null, count: 0, items: [], sources: [],
        note: 'Scraper deshabilitado (ENABLE_SCRAPER != true).'
      });
    }

    const data = await scrapePrices(product);
    res.json(data);
  } catch (err) {
    console.error('prices error:', err);
    res.status(500).json({ error: 'Error al obtener precios', detail: String(err) });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('API listening on', PORT));
