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
   MEDICATION INFO (NO TOCAR)
========================= */
app.post("/api/medication-info", async (req, res) => {
  const q = String(req.body?.q || "").trim();
  if (!q) {
    return res.json({
      medicine: "",
      info: { summary: "No se indicó un medicamento.", uses: [], precautions: [] },
    });
  }

  try {
    const prompt = `
Entrega información clara y general sobre el medicamento "${q}".
NO dosis, NO diagnóstico.
Responde SOLO JSON:
{
  "summary": "texto",
  "uses": [],
  "precautions": []
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }],
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    res.json({
      medicine: q,
      info: {
        summary: parsed.summary,
        uses: parsed.uses || [],
        precautions: parsed.precautions || [],
      },
    });
  } catch {
    res.json({
      medicine: q,
      info: {
        summary: `Información general sobre "${q}".`,
        uses: [],
        precautions: [
          "Revisa contraindicaciones del envase.",
          "Consulta a un profesional de salud ante dudas.",
        ],
      },
    });
  }
});

/* =========================
   PRICES (NO TOCAR)
========================= */
app.get("/api/prices", async (req, res) => {
  res.json({
    ok: true,
    items: [
      { chainName: "Dr. Simi", price: null },
      { chainName: "Ahumada", price: null },
      { chainName: "Salcobrand", price: null },
      { chainName: "Cruz Verde", price: null },
    ],
  });
});

/* =========================
   CHAT — FIX DEFINITIVO
========================= */
function buildAssistantPrompt(body) {
  const product =
    body?.productName ||
    body?.pricesContext?.productName ||
    body?.pricesContext?.query ||
    "este medicamento";

  return `
El usuario busca el medicamento "${product}" en Chile.

NO tienes precios exactos por farmacia.

TAREA:
- Entrega un RANGO REFERENCIAL DE PRECIOS EN CLP si el medicamento es conocido.
- Indica que el precio depende de marca, concentración y cantidad.
- Puedes mencionar que en farmacias de bajo costo suele ser más barato que en cadenas tradicionales.
- NO menciones distancias.
- NO menciones kilómetros.
- NO digas qué farmacia es más cercana.
- Di que hay farmacias cercanas visibles en el mapa para revisar disponibilidad.
- 4 a 6 líneas máximo.
- Termina SIEMPRE con:
  "Los precios pueden variar y es importante verificar en la farmacia antes de comprar."

Responde SOLO texto plano.
`;
}

app.post("/api/chat", async (req, res) => {
  try {
    const prompt = buildAssistantPrompt(req.body);

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.5,
      messages: [{ role: "user", content: prompt }],
    });

    res.json({
      reply: completion.choices[0].message.content.trim(),
    });
  } catch (e) {
    console.error(e);
    res.json({
      reply:
        "No tengo precios exactos, pero hay farmacias cercanas en el mapa para revisar disponibilidad.",
    });
  }
});

app.listen(port, () => {
  console.log(`MiPharmAPP API escuchando en puerto ${port}`);
});
