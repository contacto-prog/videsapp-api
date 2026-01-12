// server.js
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());

/* =========================
   HEALTHCHECKS
========================= */
app.get("/health", (_req, res) => {
  res.json({ ok: true, status: "MiPharmAPP API running" });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, status: "MiPharmAPP API running" });
});

/* =========================
   NUEVO ENDPOINT MEDICACIÓN
   👉 ESTE ES EL FIX
========================= */
app.post("/api/medication-info", async (req, res) => {
  const q = String(req.body?.q || "").trim();

  if (!q) {
    return res.status(400).json({
      medicine: "",
      info: {
        summary: "No se indicó un medicamento.",
        uses: [],
        precautions: [],
      },
    });
  }

  try {
    const prompt = `
Entrega información clara y general sobre el medicamento "${q}".

Incluye:
- Qué es o para qué se usa (1 frase).
- Usos comunes (máx 3 puntos).
- Precauciones importantes (máx 3 puntos).

Reglas:
- NO entregues dosis.
- NO hagas diagnóstico.
- NO inventes contraindicaciones raras.
- Lenguaje simple, para público general en Chile.
- Información general, no reemplaza orientación médica.

Responde SOLO en JSON con esta estructura exacta:

{
  "summary": "texto corto",
  "uses": ["uso 1", "uso 2"],
  "precautions": ["precaución 1", "precaución 2"]
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente de información farmacológica general para una app en Chile.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      throw new Error("Respuesta IA no es JSON válido");
    }

    return res.json({
      medicine: q,
      info: {
        summary: parsed.summary || `Información general sobre "${q}".`,
        uses: Array.isArray(parsed.uses) ? parsed.uses : [],
        precautions: Array.isArray(parsed.precautions)
          ? parsed.precautions
          : [
              "Revisa contraindicaciones y advertencias del envase.",
              "Consulta a un profesional de salud ante dudas.",
            ],
      },
    });
  } catch (err) {
    console.error("[MEDICATION INFO ERROR]", err);

    return res.json({
      medicine: q,
      info: {
        summary: `Información general sobre "${q}".`,
        uses: [],
        precautions: [
          "Revisa contraindicaciones y advertencias del envase.",
          "Consulta a un profesional de salud ante dudas.",
        ],
      },
    });
  }
});

/* =========================
   PRICES (SIN CAMBIOS)
========================= */
function normalizeUrl(u) {
  if (!u || typeof u !== "string") return null;
  let s = u.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const url = new URL(s);
    if (url.hostname === "drsimi.cl") {
      url.hostname = "www.drsimi.cl";
      url.protocol = "https:";
    }
    return url.toString();
  } catch (_) {
    return null;
  }
}

app.get("/api/prices", async (req, res) => {
  const { lat, lng, radius, product } = req.query;
  console.log("[PRICE GET]", { lat, lng, radius, product });

  const dummyItems = [
    { chainName: "Dr. Simi", price: null, distanceKm: 3.1, buyUrl: normalizeUrl("https://www.drsimi.cl/") },
    { chainName: "Ahumada", price: null, distanceKm: 3.2, buyUrl: normalizeUrl("https://www.farmaciasahumada.cl/") },
    { chainName: "Salcobrand", price: null, distanceKm: 3.6, buyUrl: normalizeUrl("https://www.salcobrand.cl/") },
    { chainName: "Cruz Verde", price: null, distanceKm: null, buyUrl: normalizeUrl("https://www.cruzverde.cl/") },
  ];

  res.json({
    ok: true,
    product: product || null,
    lat,
    lng,
    radius,
    items: dummyItems,
  });
});

/* =========================
   CHAT (SIN CAMBIOS)
========================= */
app.post("/api/chat", async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente de MiPharmAPP. Ayudas a comparar precios y farmacias en Chile.",
        },
        {
          role: "user",
          content: req.body?.message || "",
        },
      ],
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "No pude generar una recomendación en este momento.";

    res.json({ reply });
  } catch (error) {
    console.error("[CHAT ERROR]", error);
    res.status(500).json({
      reply:
        "No pude generar una recomendación en este momento. Usa los botones de la app.",
    });
  }
});

app.listen(port, () => {
  console.log(`MiPharmAPP API escuchando en puerto ${port}`);
});
