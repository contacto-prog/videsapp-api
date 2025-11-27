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
 * Utilidad para construir el prompt del asistente
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
   - Puedes dar rangos aproximados solo si te sientes razonablemente confiado (por ejemplo "suele estar entre $X y $Y"), pero deja clarísimo que es un valor referencial.
   - Recomienda cuál farmacia puede ser más conveniente según distancia o disponibilidad (por ejemplo: "Dr. Simi y Ahumada parecen las mejores opciones cercanas").
3. La respuesta DEBE ser breve (máximo 4–5 líneas) y sin viñetas ni listas largas.
4. No repitas los links; la app ya tiene botones "Ver en la web" y "Ir".
5. Siempre agrega una frase de seguridad tipo:
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
 * Endpoint de precios (ejemplo mínimo).
 * Si ya tienes tu lógica real, deja esa y solo conserva el /api/chat.
 */
app.get("/api/prices", async (req, res) => {
  const { lat, lng, radius, product } = req.query;
  console.log("[PRICE GET]", { lat, lng, radius, product });

  try {
    const dummyItems = [
      {
        chainName: "Dr. Simi",
        price: null,
        distanceKm: 3.1,
        buyUrl: "https://drsimi.cl",
      },
      {
        chainName: "Ahumada",
        price: null,
        distanceKm: 3.2,
        buyUrl: "https://www.farmaciasahumada.cl",
      },
      {
        chainName: "Salcobrand",
        price: null,
        distanceKm: 3.6,
        buyUrl: "https://www.salcobrand.cl",
      },
      {
        chainName: "Cruz Verde",
        price: null,
        distanceKm: null,
        buyUrl: "https://www.cruzverde.cl",
      },
      {
        chainName: "Farmaexpress",
        price: null,
        distanceKm: null,
        buyUrl: "https://farmex.cl",
      },
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
