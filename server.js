// server.js

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { evaluate } = require("mathjs");

const app = express();

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || "*";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// --------------------------------------------------
// Middleware
// --------------------------------------------------

app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    origin: FRONTEND_URL === "*" ? true : FRONTEND_URL,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// --------------------------------------------------
// Health Check
// --------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "AI Calculator",
    model: GEMINI_MODEL,
    timestamp: new Date().toISOString(),
  });
});

// --------------------------------------------------
// Deterministic Calculator
// AI केवल समस्या समझेगा.
// असली calculation JavaScript/mathjs करेगा.
// --------------------------------------------------

function calculateDeterministically(data) {
  const type = data.type;

  switch (type) {
    // ----------------------------------------------
    // BASIC
    // ----------------------------------------------
    case "basic": {
      const result = evaluate(data.expression);

      return {
        value: result,
        formatted: Number(result).toLocaleString("en-IN"),
      };
    }

    // ----------------------------------------------
    // GST
    // ----------------------------------------------
    case "gst": {
      const amount = Number(data.amount);
      const rate = Number(data.rate);

      if (!Number.isFinite(amount) || !Number.isFinite(rate)) {
        throw new Error("Invalid GST values");
      }

      const gst = amount * (rate / 100);
      const total = amount + gst;

      return {
        originalAmount: amount,
        gstRate: rate,
        gstAmount: gst,
        total: total,
      };
    }

    // ----------------------------------------------
    // GST INCLUDED
    // ----------------------------------------------
    case "gst_inclusive": {
      const total = Number(data.amount);
      const rate = Number(data.rate);

      if (!Number.isFinite(total) || !Number.isFinite(rate)) {
        throw new Error("Invalid GST inclusive values");
      }

      const base = total / (1 + rate / 100);
      const gst = total - base;

      return {
        totalAmount: total,
        gstRate: rate,
        baseAmount: base,
        gstAmount: gst,
      };
    }

    // ----------------------------------------------
    // DISCOUNT
    // ----------------------------------------------
    case "discount": {
      const amount = Number(data.amount);
      const rate = Number(data.rate);

      if (!Number.isFinite(amount) || !Number.isFinite(rate)) {
        throw new Error("Invalid discount values");
      }

      const discount = amount * (rate / 100);
      const finalAmount = amount - discount;

      return {
        originalAmount: amount,
        discountRate: rate,
        discountAmount: discount,
        finalAmount: finalAmount,
      };
    }

    // ----------------------------------------------
    // PROFIT / LOSS
    // ----------------------------------------------
    case "profit_loss": {
      const costPrice = Number(data.costPrice);
      const sellingPrice = Number(data.sellingPrice);

      if (!Number.isFinite(costPrice) || !Number.isFinite(sellingPrice)) {
        throw new Error("Invalid profit/loss values");
      }

      const difference = sellingPrice - costPrice;

      const percentage =
        costPrice === 0 ? 0 : (difference / costPrice) * 100;

      return {
        costPrice,
        sellingPrice,
        difference,
        percentage,
        status:
          difference > 0
            ? "profit"
            : difference < 0
              ? "loss"
              : "no_profit_no_loss",
      };
    }

    // ----------------------------------------------
    // EMI
    // ----------------------------------------------
    case "emi": {
      const principal = Number(data.principal);
      const annualRate = Number(data.annualRate);
      const years = Number(data.years);

      if (
        !Number.isFinite(principal) ||
        !Number.isFinite(annualRate) ||
        !Number.isFinite(years)
      ) {
        throw new Error("Invalid EMI values");
      }

      const monthlyRate = annualRate / 12 / 100;
      const months = years * 12;

      let emi;

      if (monthlyRate === 0) {
        emi = principal / months;
      } else {
        emi =
          (principal *
            monthlyRate *
            Math.pow(1 + monthlyRate, months)) /
          (Math.pow(1 + monthlyRate, months) - 1);
      }

      const totalPayment = emi * months;
      const totalInterest = totalPayment - principal;

      return {
        principal,
        annualRate,
        years,
        months,
        monthlyEMI: emi,
        totalPayment,
        totalInterest,
      };
    }

    // ----------------------------------------------
    // AVERAGE
    // ----------------------------------------------
    case "average": {
      const numbers = data.numbers.map(Number);

      if (
        !Array.isArray(numbers) ||
        numbers.length === 0 ||
        numbers.some((n) => !Number.isFinite(n))
      ) {
        throw new Error("Invalid average values");
      }

      const sum = numbers.reduce((a, b) => a + b, 0);
      const average = sum / numbers.length;

      return {
        numbers,
        sum,
        average,
      };
    }

    // ----------------------------------------------
    // AREA
    // ----------------------------------------------
    case "area": {
      const length = Number(data.length);
      const width = Number(data.width);

      if (!Number.isFinite(length) || !Number.isFinite(width)) {
        throw new Error("Invalid area values");
      }

      const area = length * width;

      return {
        length,
        width,
        area,
      };
    }

    default:
      throw new Error("Unsupported calculation type");
  }
}

// --------------------------------------------------
// Gemini AI
// --------------------------------------------------

async function askGemini(userQuery, conversation = []) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const systemInstruction = `
You are the intelligence layer of a calculator application.

Your job is ONLY to understand the user's calculation request
and convert it into strict JSON.

IMPORTANT:
- Never calculate the final answer yourself.
- Never use commas inside mathematical expressions.
- Never put currency symbols inside numeric values.
- Return JSON only.
- Do not use markdown.
- Do not invent missing numbers.
- If information is missing, return type "clarification".

Supported types:

basic:
{
  "type": "basic",
  "expression": "500+500"
}

gst:
{
  "type": "gst",
  "amount": 50000,
  "rate": 18
}

gst_inclusive:
{
  "type": "gst_inclusive",
  "amount": 59000,
  "rate": 18
}

discount:
{
  "type": "discount",
  "amount": 500,
  "rate": 20
}

profit_loss:
{
  "type": "profit_loss",
  "costPrice": 1000,
  "sellingPrice": 1200
}

emi:
{
  "type": "emi",
  "principal": 200000,
  "annualRate": 10,
  "years": 5
}

average:
{
  "type": "average",
  "numbers": [10,20,30,40]
}

area:
{
  "type": "area",
  "length": 12,
  "width": 15
}

clarification:
{
  "type": "clarification",
  "message": "Ask the user for the missing information."
}

Examples:

"500 + 500"
=> {"type":"basic","expression":"500+500"}

"18% GST on ₹50,000"
=> {"type":"gst","amount":50000,"rate":18}

"₹50,000 including 18% GST"
=> {"type":"gst_inclusive","amount":50000,"rate":18}

"₹500 with 20% discount"
=> {"type":"discount","amount":500,"rate":20}

"₹1000 CP and ₹1200 SP profit"
=> {"type":"profit_loss","costPrice":1000,"sellingPrice":1200}

"₹2,00,000 loan at 10% for 5 years EMI"
=> {"type":"emi","principal":200000,"annualRate":10,"years":5}

"Average of 10,20,30,40"
=> {"type":"average","numbers":[10,20,30,40]}

"12 feet × 15 feet room area"
=> {"type":"area","length":12,"width":15}

For follow-up questions, use the previous conversation context.
`;

  const contents = [];

  for (const item of conversation) {
    if (!item || !item.role || !item.content) continue;

    contents.push({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: String(item.content) }],
    });
  }

  contents.push({
    role: "user",
    parts: [{ text: userQuery }],
  });

  const response = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemInstruction }],
      },
      contents,
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    console.error(
      `Gemini request failed: HTTP ${response.status}`
    );

    throw new Error("AI service request failed");
  }

  const result = await response.json();

  const text =
    result?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("AI returned an empty response");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("AI returned invalid JSON");
  }
}

// --------------------------------------------------
// Main Calculate API
// --------------------------------------------------

app.post("/api/calculate", async (req, res) => {
  try {
    const { query, conversation = [] } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({
        success: false,
        error: "Please enter a calculation.",
      });
    }

    const aiData = await askGemini(query, conversation);

    // ----------------------------------------------
    // Missing information
    // ----------------------------------------------

    if (aiData.type === "clarification") {
      return res.json({
        success: true,
        type: "clarification",
        result: aiData.message || "Please provide more information.",
      });
    }

    // ----------------------------------------------
    // Deterministic calculation
    // ----------------------------------------------

    const calculation = calculateDeterministically(aiData);

    return res.json({
      success: true,
      model: GEMINI_MODEL,
      type: aiData.type,
      input: query,
      calculation,
    });
  } catch (error) {
    console.error("Calculation error:", error.message);

    return res.status(500).json({
      success: false,
      error:
        "Sorry, calculation could not be completed. Please try again.",
    });
  }
});

// --------------------------------------------------
// Start Server
// --------------------------------------------------

app.listen(PORT, () => {
  console.log(`AI Calculator backend running on port ${PORT}`);
  console.log(`Model: ${GEMINI_MODEL}`);
});