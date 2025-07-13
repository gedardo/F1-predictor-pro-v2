import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { NewsArticle } from '../types';

// API_KEY is obtained directly from process.env.API_KEY as per guidelines.
// It's assumed to be pre-configured, valid, and accessible.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getF1News = async (): Promise<NewsArticle[]> => {
  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-04-17",
      contents: "Proporciona 3 titulares de noticias recientes y relevantes sobre Fórmula 1, en español. Solo los titulares, sin numeración ni guiones.",
    });

    const text = response.text; // Access .text directly as per guidelines
    // Ensure text is not undefined or null before splitting
    const headlines = text ? text.split('\n').filter(line => line.trim() !== '') : [];
    
    if (headlines.length === 0 && text && text.trim() !== '') {
        // If splitting results in no headlines but there was text,
        // it might be a single headline without newlines.
        return [{ title: text.trim() }];
    }
    
    if (headlines.length > 0) {
        return headlines.map(title => ({ title }));
    }

    // If no headlines and no text, or text was empty/whitespace
    console.warn("Gemini news response was empty or not in expected format.");
    return [
        { title: "No se encontraron noticias recientes." }
    ];

  } catch (error) {
    console.error("Error fetching F1 news from Gemini:", error);
    // Fallback if the API call fails (e.g. API key issue, network error, etc.)
    return [
      { title: "Error al cargar noticias. Inténtalo más tarde." },
      { title: "Noticia (Fallback): Próximas carreras y análisis." },
      { title: "Noticia (Fallback): Novedades en los equipos de F1." },
    ];
  }
};