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
   MEDICATION INFO (SIN CAMBIOS)
========================= */
app.post("/api/medication-info", async (req, res) => {
  const q = String(req.body?.q || "").trim();

  if (!q) {
    return res.status(400).json({
      medicine: "",
      info: { summary: "No se indicó un medicamento.", uses: [], precautions: [] },
    });
  }

  try {
    const prompt = `
Entrega información clara y general sobre el medicamento "${q}".

Incluye:
- Qué es o para qué se usa (1 frase).
- Usos comunes (máx 3).
- Precauciones importantes (máx 3).

Reglas:
- NO dosis
- NO diagnósticos
- Lenguaje simple
- Público general en Chile
- Información general, no reemplaza orientación médica

Responde SOLO en JSON:
{
  "summary": "texto",
  "uses": [],
  "precautions": []
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: "Asistente farmacológico general para Chile." },
        { role: "user", content: prompt },
      ],
    });

    const parsed = JSON.parse(
      completion.choices?.[0]?.message?.content || "{}"
    );

    res.json({
      medicine: q,
      info: {
        summary: parsed.summary || `Información general sobre "${q}".`,
        uses: Array.isArray(parsed.uses) ? parsed.uses : [],
        precautions: Array.isArray(parsed.precautions)
          ? parsed.precautions
          : [
              "Revisa contraindicaciones del envase.",
              "Consulta a un profesional de salud ante dudas.",
            ],
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
  } catch {
    return null;
  }
}

app.get("/api/prices", async (req, res) => {
  const { lat, lng, radius, product } = req.query;

  const items = [
    { chainName: "Dr. Simi", price: null, distanceKm: 3.1, buyUrl: normalizeUrl("https://www.drsimi.cl/") },
    { chainName: "Ahumada", price: null, distanceKm: 3.2, buyUrl: normalizeUrl("https://www.farmaciasahumada.cl/") },
    { chainName: "Salcobrand", price: null, distanceKm: 3.6, buyUrl: normalizeUrl("https://www.salcobrand.cl/") },
    { chainName: "Cruz Verde", price: null, distanceKm: null, buyUrl: normalizeUrl("https://www.cruzverde.cl/") },
  ];

  res.json({ ok: true, product, lat, lng, radius, items });
});

/* =========================
   CHAT — FIX (SIN DISTANCIAS NI NOMBRES)
========================= */
function buildAssistantPrompt(body) {
  const product =
    body?.productName ||
    body?.pricesContext?.productName ||
    body?.pricesContext?.query ||
    "este medicamento";

  const items = Array.isArray(body?.pricesContext?.items)
    ? body.pricesContext.items
    : [];

  const hasPrices = items.some((i) => typeof i.price === "number");

  // Si no hay precios reales, entregamos rango estimado, pero SIN hablar de distancia ni nombres de farmacias.
  if (!hasPrices) {
    return `
El usuario busca el medicamento "${product}" en Chile.

No hay precios exactos por farmacia.

TAREA:
- Si el medicamento es conocido, entrega un RANGO REFERENCIAL EN CLP para Chile (ej: "suele estar aprox entre $X y $Y").
- Si NO tienes referencia, dilo explícitamente.
- Siempre aclara que depende de la marca, concentración y cantidad (presentación).
- NO menciones distancias ni nombres de farmacias.
- Sí puedes decir: "hay farmacias cercanas en el mapa" y que use "Ver en la web" e "Ir" para confirmar.
- 4 a 6 líneas máximo.
- Termina SIEMPRE con:
  "Los precios pueden variar y es importante verificar en la farmacia antes de comprar."

Responde SOLO texto, sin Markdown.
`;
  }

  // Si algún día llegan precios reales, queda esta rama lista.
  return `
Hay precios reales disponibles para "${product}".
Compara brevemente y di cuál conviene más.
Máximo 4 a 6 líneas.
Termina con:
"Los precios pueden variar y es importante verificar en la farmacia antes de comprar."
`;
}

app.post("/api/chat", async (req, res) => {
  try {
    const prompt = buildAssistantPrompt(req.body);

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente de MiPharmAPP. Entregas orientación breve sobre precios referenciales de medicamentos en Chile (sin inventar datos exactos por farmacia).",
        },
        { role: "user", content: prompt },
      ],
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "No pude generar una recomendación en este momento.";

    res.json({ reply });
  } catch (e) {
    console.error("[CHAT ERROR]", e);
    res.json({
      reply:
        "No tengo precios exactos, pero hay farmacias cercanas en el mapa. Usa los botones para revisar disponibilidad y precios.",
    });
  }
});

app.listen(port, () => {
  console.log(`MiPharmAPP API escuchando en puerto ${port}`);
});
