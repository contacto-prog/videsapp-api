import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("API de VIDESAPP funcionando 🚀");
});

app.get("/prices", (req, res) => {
  const { product } = req.query;
  res.json({ product, price: "No disponible aún" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
