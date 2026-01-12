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
Entrega información clara, útil y específica sobre el medicamento "${q}".

Incluye:
- Qué es o para qué se usa (1 frase clara).
- Usos comunes reales (máx 3).
- Precauciones importantes (máx 3).

Reglas estrictas:
- NO entregar dosis.
- NO hacer diagnóstico.
- Lenguaje simple para público general en Chile.
- Si es antibiótico, menciónalo.
- Si es de uso crónico, menciónalo.
- No seas genérico.

Responde SOLO en JSON válido:
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

    const parsed = JSON.parse(completion.choices[0].message.content);

    res.json({
      medicine: q,
      info: {
        summary: parsed.summary,
        uses: parsed.uses ?? [],
        precautions: parsed.precautions ?? [],
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
