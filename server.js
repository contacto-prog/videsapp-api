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

/* ---------------- HEALTH ---------------- */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, status: "MiPharmAPP API running" });
});

/* ---------------- MEDICATION INFO (NUEVO) ---------------- */
app.post("/api/medication-info", async (req, res) => {
  try {
    const query = (req.body?.query || "").trim();

    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente informativo de medicamentos para una app en Chile. " +
            "NO diagnosticas, NO das dosis, NO recomiendas tratamientos. " +
            "Entregas solo información general y segura.",
        },
        {
          role: "user",
          content: `
Medicamento: "${query}"

Devuelve un JSON con esta estructura exacta:
{
  "normalizedName": string,
  "genericName": string,
  "shortDescription": string,
  "commonUses": string[],
  "precautions": string[],
  "brands": string[]
}

Reglas:
- Máximo 2 usos comunes
- Máximo 3 precauciones
- Lenguaje claro, español de Chile
- NO menciones dosis ni indicaciones médicas
          `,
        },
      ],
      response_format: { type: "json_object" },
    });

    const json =
      completion.choices?.[0]?.message?.content &&
      JSON.parse(completion.choices[0].message.content);

    if (!json) throw new Error("Invalid AI response");

    res.json(json);
  } catch (err) {
    console.error("[MEDICATION INFO ERROR]", err);
    res.status(500).json({
      normalizedName: req.body?.query || "Medicamento",
      genericName: "",
      shortDescription:
        "Información general no disponible en este momento.",
      commonUses: [],
      precautions: [
        "Revisa la información del envase.",
        "Consulta a un profesional de la salud ante dudas.",
      ],
      brands: [],
    });
  }
});

/* ---------------- PRICES (SIN CAMBIOS) ---------------- */
app.get("/api/prices", async (req, res) => {
  const { lat, lng, radius, product } = req.query;

  res.json({
    ok: true,
    product,
    lat,
    lng,
    radius,
    items: [
      { chainName: "Dr. Simi", price: null, distanceKm: 3.1 },
      { chainName: "Ahumada", price: null, distanceKm: 3.2 },
      { chainName: "Salcobrand", price: null, distanceKm: 3.6 },
      { chainName: "Cruz Verde", price: null, distanceKm: null },
    ],
  });
});

/* ---------------- CHAT (SIN CAMBIOS) ---------------- */
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

    res.json({
      reply:
        completion.choices?.[0]?.message?.content ||
        "No se pudo generar respuesta.",
    });
  } catch (e) {
    res.status(500).json({
      reply:
        "No pude generar una recomendación en este momento.",
    });
  }
});

app.listen(port, () => {
  console.log(`MiPharmAPP API escuchando en puerto ${port}`);
});
