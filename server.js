const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

// Ruta principal
app.get('/', (req, res) => {
  res.send('✅ API de VIDESAPP funcionando correctamente 🚀');
});

// Endpoint de precios de prueba
app.get('/prices', (req, res) => {
  const product = req.query.product || 'desconocido';
  res.json({
    product,
    price: 'No disponible aún',
    message: 'API base funcionando correctamente'
  });
});

// Puerto dinámico para Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
