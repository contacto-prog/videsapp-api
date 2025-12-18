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

/**
 * Utilidad para construir el prompt del asistente (PRECIOS)
 */
function buildAssistantPrompt(body) {
  const message = body?.message || "";
  const productNameFromBody = body?.productName;
  const pricesContext = body?.pricesContext || {};
  const items = Array.isArray(pricesContext.items) ? pricesContext.items : [];

  const productName =
    productNameFromBody ||
    pricesContext.productName ||
    pricesContext.query ||
    "este medicamento";

  const chains = items
    .map((it) => ({
      chainName: it.chainName || "Farmacia",
      price: typeof it.price === "number" ? it.price : null,
      distanceKm: typeof it.distanceKm === "number" ? it.distanceKm : null,
      buyUrl: it.buyUrl || null,
    }))
    .filter((it) => !!it.chainName);

  const hasAnyPrice = chains.some((c) => c.price !== null);
  let cheapest = null;

  if (hasAnyPrice) {
    cheapest = chains
      .filter((c) => c.price !== null)
      .sort((a, b) => a.price - b.price)[0];
  }

  let contextText = "";
  if (chains.length === 0) {
    contextText = `No vienen farmacias en el contexto. Solo responde de forma muy corta que no tienes datos y que use los botones de la app.`;
  } else {
    const lines = chains.map((c) => {
      const priceText =
        c.price !== null ? `$${c.price.toLocaleString("es-CL")}` : "sin precio";
      const distText =
        c.distanceKm !== null ? `${c.distanceKm.toFixed(1)} km` : "distancia desconocida";
      return `- ${c.chainName}: ${priceText}, ${distText}`;
    });
    contextText = `Farmacias cercanas en el contexto:\n${lines.join("\n")}`;
  }

  return `
El usuario está buscando el medicamento: "${productName}".

Mensaje del usuario: "${message}".

${contextText}

TU TAREA:
1. Si hay precios (price != null), compara los precios y distancias.
   - Di claramente qué farmacia conviene más y por qué (más barata, más cerca, equilibrio precio/distancia).
   - Puedes mencionar 2–3 alternativas como máximo.
   - Responde en tono simple y cercano, en español de Chile.
2. Si NO hay precios en el contexto, asume que la app no pudo leer los precios reales.
   - NO inventes precios exactos para esas farmacias específicas.
   - Puedes dar rangos aproximados solo si te sientes razonablemente confiado, pero deja clarísimo que es referencial.
   - Recomienda cuál farmacia puede ser más conveniente según distancia o disponibilidad.
3. La respuesta DEBE ser breve (máximo 4–5 líneas) y sin viñetas ni listas largas.
4. No repitas links; la app ya tiene botones "Ver en la web" y "Ir".
5. Siempre agrega:
   "Los precios pueden variar y es importante verificar en la farmacia antes de comprar."

Responde SOLO con el texto que se muestra en la tarjeta azul, sin formato Markdown.
  `;
}

/**
 * Healthcheck simple
 */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, status: "MiPharmAPP API running" });
});

/**
 * NUEVO: Endpoint de ficha informativa del medicamento (para "Buscar medicamento")
 * - No diagnostica
 * - No da dosis
 * - No indica tratamientos
 */
app.post("/api/medication-info", async (req, res) => {
  try {
    const queryRaw = (req.body?.query || req.body?.productName || "").toString();
    const query = queryRaw.trim();

    if (!query) {
      return res.status(400).json({ ok: false, error: "Falta query" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.25,
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente informativo de medicamentos para una app en Chile. " +
            "NO diagnosticas, NO das dosis, NO recomiendas tratamientos. " +
            "Entregas información general y segura, con advertencias.",
        },
        {
          role: "user",
          content: `
Medicamento consultado: "${query}"

Devuelve SOLO un JSON con esta estructura exacta:
{
  "normalizedName": string,
  "shortDescription": string,
  "commonUses": string[],
  "precautions": string[],
  "disclaimer": string
}

Reglas:
- shortDescription: 1–2 frases máximo
- commonUses: máximo 2 elementos
- precautions: máximo 3 elementos
- disclaimer: "MiPharmAPP no reemplaza la orientación médica profesional."
- Español de Chile
- Sin dosis, sin posología, sin diagnóstico
          `,
        },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion.choices?.[0]?.message?.content?.trim();
    const parsed = raw ? JSON.parse(raw) : null;

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Respuesta IA inválida");
    }

    res.json({ ok: true, ...parsed });
  } catch (error) {
    console.error("[MEDICATION INFO ERROR]", error);
    res.status(500).json({
      ok: false,
      normalizedName: req.body?.query || req.body?.productName || "Medicamento",
      shortDescription: "Información no disponible en este momento.",
      commonUses: [],
      precautions: [
        "Revisa contraindicaciones y advertencias del envase.",
        "Consulta a un profesional de salud ante dudas.",
      ],
      disclaimer: "MiPharmAPP no reemplaza la orientación médica profesional.",
    });
  }
});

/**
 * Endpoint de precios (ejemplo mínimo).
 * Si ya tienes tu lógica real, deja esa y solo conserva /api/chat y /api/medication-info.
 */
app.get("/api/prices", async (req, res) => {
  const { lat, lng, radius, product } = req.query;
  console.log("[PRICE GET]", { lat, lng, radius, product });

  try {
    const dummyItems = [
      { chainName: "Dr. Simi", price: null, distanceKm: 3.1, buyUrl: "https://drsimi.cl" },
      { chainName: "Ahumada", price: null, distanceKm: 3.2, buyUrl: "https://www.farmaciasahumada.cl" },
      { chainName: "Salcobrand", price: null, distanceKm: 3.6, buyUrl: "https://www.salcobrand.cl" },
      { chainName: "Cruz Verde", price: null, distanceKm: null, buyUrl: "https://www.cruzverde.cl" },
      { chainName: "Farmaexpress", price: null, distanceKm: null, buyUrl: "https://farmex.cl" },
    ];

    res.json({
      ok: true,
      product: product || null,
      lat,
      lng,
      radius,
      items: dummyItems,
    });
  } catch (err) {
    console.error("[PRICE ERROR]", err);
    res.status(500).json({ ok: false, error: "No se pudieron obtener precios." });
  }
});

/**
 * Endpoint del asistente de precios
 */
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
            "Eres un asistente de MiPharmAPP. Ayudas a comparar precios y farmacias en Chile. Siempre respondes en español, breve y claro.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() ||
      "No pude generar una recomendación en este momento. Usa los botones de la app para revisar los detalles en cada farmacia.";

    res.json({ reply });
  } catch (error) {
    console.error("[CHAT ERROR]", error);
    res.status(500).json({
      reply:
        "No pude generar una recomendación en este momento. Usa los botones de la app para revisar disponibilidad y precios actualizados.",
    });
  }
});

app.listen(port, () => {
  console.log(`MiPharmAPP API escuchando en puerto ${port}`);
});
