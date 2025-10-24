// server.js – versión estable para Render
import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(compression());
app.use(morgan("tiny"));

// Render inyecta el puerto correcto
const PORT = process.env.PORT || 8080;

app.get("/", (_req, res) => {
  res.type("text/plain").send("VIDESAPP API – OK");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "videsapp-api",
    port: PORT,
    node: process.version,
    time: new Date().toISOString(),
  });
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not_found", path: req.path });
});

const server = app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});

function shutdown() {
  console.log("Shutting down...");
  try {
    server.close();
  } catch {}
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
