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
 * Normaliza URLs para evitar links rotos (ej: drsimi.cl sin https / sin www)
 */
function normalizeUrl(u) {
  if (!u || typeof u !== "string") return null;

  let s = u.trim();

  // Si viene sin protocolo, lo forzamos a https
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;

  try {
    const url = new URL(s);

    // Fix específico Dr Simi: preferimos el dominio que sí responde
    // (drsimi.cl suele fallar / redirigir raro en algunos contextos)
    if (url.hostname === "drsimi.cl") {
      url.hostname = "www.drsimi.cl";
      url.protocol = "https:";
      return url.toString();
    }

    return url.toString();
  } catch (_) {
    return null;
  }
}

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
      buyUrl: normalizeUrl(it.buyUrl) || null,
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
    contextText =
      "No vienen farmacias en el contexto. Responde corto que no tienes datos y que use los botones de la app.";
  } else {
    const lines = chains.map((c) => {
      const priceText =
        c.price !== null ? `$${c.price.toLocaleString("es-CL")}` : "sin precio";
      const distText =
        c.distanceKm !== null
          ? `${c.distanceKm.toFixed(1)} km`
          : "distancia desconocida";
      return `- ${c.chainName}: ${priceText}, ${distText}`;
    });
    contextText = `Farmacias cercanas en el contexto:\n${lines.join("\n")}`;
  }

  return `
El usuario está buscando el medicamento: "${productName}".
Mensaje del usuario: "${message}".

${contextText}

TU TAREA:
1) Si hay precios (price != null):
   - Compara precios y distancias.
   - Di cuál conviene más y por qué.
   - Menciona máximo 2 alternativas.
2) Si NO hay precios en el contexto:
   - NO inventes precios exactos por farmacia.
   - PERO entrega un rango referencial en CLP para Chile si es un medicamento conocido
     (por ejemplo "suele estar aprox entre $X y $Y", indicando que es estimado).
   - Si no tienes referencia, dilo y sugiere revisar con los botones de la app.
3) Respuesta breve: 4 a 6 líneas máximo (sin listas largas).
4) No pegues links (la app ya tiene botones "Ver en la web" y "Ir").
5) Siempre agrega al final:
   "Los precios pueden variar y es importante verificar en la farmacia antes de comprar."

Responde SOLO con el texto que se muestra en la tarjeta azul, sin Markdown.
`;
}

/**
 * Healthcheck (Render suele usar /health, tu app usa /api/health)
 */
app.get("/health", (_req, res) => {
  res.json({ ok: true, status: "MiPharmAPP API running" });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, status: "MiPharmAPP API running" });
});

/**
 * Endpoint de precios (ejemplo mínimo).
 * OJO: aquí también corregimos buyUrl para que no mande drsimi.cl pelado.
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
        buyUrl: normalizeUrl("https://www.drsimi.cl/"), // ✅ corregido
      },
      {
        chainName: "Ahumada",
        price: null,
        distanceKm: 3.2,
        buyUrl: normalizeUrl("https://www.farmaciasahumada.cl/"),
      },
      {
        chainName: "Salcobrand",
        price: null,
        distanceKm: 3.6,
        buyUrl: normalizeUrl("https://www.salcobrand.cl/"),
      },
      {
        chainName: "Cruz Verde",
        price: null,
        distanceKm: null,
        buyUrl: normalizeUrl("https://www.cruzverde.cl/"),
      },
      {
        chainName: "Farmaexpress",
        price: null,
        distanceKm: null,
        buyUrl: normalizeUrl("https://farmex.cl/"),
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
