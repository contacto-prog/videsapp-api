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
   MEDICATION INFO
   (BUSCAR TU MEDICAMENTO)
========================= */
app.post("/api/medication-info", async (req, res) => {
  const q = String(req.body?.q || "").trim();

  if (!q) {
    return res.json({
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
Entrega información clara, útil y específica sobre el medicamento "${q}".

Incluye:
- Qué es o para qué se usa (1 frase clara).
- Usos comunes reales (máx 3).
- Precauciones importantes (máx 3).

Reglas estrictas:
- NO entregar dosis.
- NO hacer diagnóstico.
- Lenguaje simple para público general en Chile.
- Si es antibiótico, indícalo.
- Si es de uso crónico, indícalo.
- No seas genérico.

Responde SOLO en JSON válido con esta estructura exacta:
{
  "summary": "texto",
  "uses": ["uso 1", "uso 2"],
  "precautions": ["precaución 1", "precaución 2"]
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);

    res.json({
      medicine: q,
      info: {
        summary: parsed.summary ?? `Información general sobre "${q}".`,
        uses: Array.isArray(parsed.uses) ? parsed.uses : [],
        precautions: Array.isArray(parsed.precautions)
          ? parsed.precautions
          : [],
      },
    });
  } catch (e) {
    console.error("[MEDICATION INFO ERROR]", e);
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

/* ================= =========================
   PRICES (NO TOCAR)
========================= */
app.get("/api/prices", async (_req, res) => {
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
   CHAT
   (TARJETA AZUL – RANGO DE PRECIOS)
========================= */
function buildPriceAssistantPrompt(body) {
  const product =
    body?.productName ||
    body?.pricesContext?.productName ||
    body?.pricesContext?.query ||
    "este medicamento";

  return `
El usuario busca el medicamento "${product}" en Chile.

No tienes precios exactos por farmacia.

TAREA:
- Entrega un rango REFERENCIAL de precios en pesos chilenos (CLP) si es un medicamento conocido.
- Aclara que depende de marca, concentración y cantidad.
- Menciona que farmacias de bajo costo suelen ser más económicas que cadenas tradicionales.
- Indica que hay farmacias cercanas visibles en el mapa para revisar disponibilidad.
- NO menciones distancias.
- NO menciones kilómetros.
- 4 a 6 líneas máximo.
- Termina SIEMPRE con:
"Los precios pueden variar y es importante verificar en la farmacia antes de comprar."

Responde SOLO texto plano.
`;
}

app.post("/api/chat", async (req, res) => {
  try {
    const prompt = buildPriceAssistantPrompt(req.body);

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.5,
      messages: [{ role: "user", content: prompt }],
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "No tengo precios exactos, pero hay farmacias cercanas en el mapa para revisar disponibilidad.";

    res.json({ reply });
  } catch (e) {
    console.error("[CHAT ERROR]", e);
    res.json({
      reply:
        "No tengo precios exactos, pero hay farmacias cercanas en el mapa para revisar disponibilidad.",
    });
  }
});

app.listen(port, () => {
  console.log(`MiPharmAPP API escuchando en puerto ${port}`);
});
