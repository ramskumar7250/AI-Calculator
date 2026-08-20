import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { evaluate } from "mathjs";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ===============================
// FRONTEND
// ===============================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use(express.static(__dirname));

// ===============================
// HEALTH CHECK
// ===============================
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "AI Calculator",
    model: "gemini-2.5-flash",
    timestamp: new Date().toISOString()
  });
});

// ===============================
// CALCULATOR + AI
// ===============================
async function calculateHandler(req, res) {
  try {
    const question =
      req.body?.question ||
      req.body?.text ||
      req.body?.query ||
      "";

    if (!question.trim()) {
      return res.status(400).json({
        success: false,
        error: "Question is required"
      });
    }

    // --------------------------------
    // 1. Simple mathematical expression
    // --------------------------------
    try {
      const result = evaluate(question);

      if (
        result !== undefined &&
        typeof result !== "object" &&
        !Number.isNaN(Number(result))
      ) {
        return res.json({
          success: true,
          result: String(result),
          answer: String(result),
          type: "calculator"
        });
      }
    } catch (error) {
      // Not a simple expression — continue to AI
    }

    // --------------------------------
    // 2. Gemini AI
    // --------------------------------
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "GEMINI_API_KEY is not configured"
      });
    }

    const prompt = `
You are an intelligent AI Calculator.

Solve the user's question accurately.

User question:
${question}

Rules:
- Give the correct final answer.
- For mathematical questions, show useful steps.
- Keep the explanation simple and clear.
- Do not invent information.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
        encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API Error:", data);

      return res.status(response.status).json({
        success: false,
        error: "Gemini API request failed",
        details: data
      });
    }

    const answer =
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("") || "No answer generated.";

    return res.json({
      success: true,
      result: answer,
      answer: answer,
      type: "ai",
      model: "gemini-2.5-flash"
    });

  } catch (error) {
    console.error("Server Error:", error);

    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
}

// Multiple compatible API routes
app.post("/api/calculate", calculateHandler);
app.post("/api/solve", calculateHandler);
app.post("/api/ask", calculateHandler);

// ===============================
// START SERVER
// ===============================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`AI Calculator backend running on port ${PORT}`);
  console.log("Model: gemini-2.5-flash");
});