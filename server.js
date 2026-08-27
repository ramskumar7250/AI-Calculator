const express = require('express');
const path = require('path');
const fs = require('fs');

// ============================================================
// FETCH
// ============================================================

const fetchFn =
  globalThis.fetch ||
  ((...args) =>
    import('node-fetch').then(({ default: f }) => f(...args)));

const app = express();

// ============================================================
// REQUEST LOGGER
// ============================================================

app.use((req, res, next) => {
  console.log(
    `${new Date().toISOString()} ${req.method} ${req.originalUrl}`
  );
  next();
});

// ============================================================
// CORS
// ============================================================

app.use((req, res, next) => {
  const allowedOrigin =
    process.env.ALLOWED_ORIGIN || '*';

  res.header(
    'Access-Control-Allow-Origin',
    allowedOrigin
  );

  res.header(
    'Access-Control-Allow-Methods',
    'GET,POST,OPTIONS'
  );

  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type'
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// ============================================================
// BODY PARSER
// ============================================================

app.use(express.json({ limit: '1mb' }));

// ============================================================
// FRONTEND
// ============================================================

const PUBLIC_DIR =
  path.join(__dirname, 'public');

const INDEX_FILE =
  path.join(PUBLIC_DIR, 'index.html');

app.use(express.static(PUBLIC_DIR));

// ============================================================
// DEBUG FILES
// ============================================================

app.get('/api/debug-files', (req, res) => {
  res.json({
    __dirname,
    PUBLIC_DIR,
    INDEX_FILE,

    publicDirExists:
      fs.existsSync(PUBLIC_DIR),

    indexFileExists:
      fs.existsSync(INDEX_FILE),

    rootContents:
      fs.existsSync(__dirname)
        ? fs.readdirSync(__dirname)
        : [],

    publicContents:
      fs.existsSync(PUBLIC_DIR)
        ? fs.readdirSync(PUBLIC_DIR)
        : []
  });
});

// ============================================================
// ROOT
// ============================================================

app.get('/', (req, res) => {
  if (fs.existsSync(INDEX_FILE)) {
    return res.sendFile(INDEX_FILE);
  }

  return res.status(500).json({
    error:
      'public/index.html was not found on the server.',
    lookedIn: INDEX_FILE
  });
});

// ============================================================
// HEALTH CHECK
// ============================================================

function healthCheck(req, res) {
  res.json({
    status: 'ok',

    provider: 'groq',

    hasApiKey:
      !!process.env.GROQ_API_KEY,

    model:
      process.env.GROQ_MODEL ||
      'openai/gpt-oss-20b',

    time:
      new Date().toISOString()
  });
}

app.get('/health', healthCheck);
app.get('/api/health', healthCheck);

// ============================================================
// SAFE API KEY DEBUG
// ============================================================

app.get('/api/debug-key', (req, res) => {
  const raw =
    process.env.GROQ_API_KEY;

  if (!raw) {
    return res.json({
      readFrom:
        'process.env.GROQ_API_KEY',

      exists: false,

      note:
        'GROQ_API_KEY is missing. Check Render Environment Variables.'
    });
  }

  const trimmed =
    raw.trim();

  res.json({
    readFrom:
      'process.env.GROQ_API_KEY',

    exists: true,

    length:
      raw.length,

    lengthAfterTrim:
      trimmed.length,

    hadSurroundingWhitespace:
      raw.length !== trimmed.length,

    prefix:
      trimmed.slice(0, 7),

    looksLikeGroqFormat:
      trimmed.startsWith('gsk_')
  });
});

// ============================================================
// SYSTEM PROMPT
// IMPORTANT:
// This prompt is intentionally SHORT to reduce token usage.
// ============================================================

const SYSTEM_PROMPT = `
You are the classification engine for an AI Calculator.

Read the user's English, Hindi, or Hinglish calculation question.

Your job is ONLY to identify the calculation type and extract values.

DO NOT calculate.
DO NOT explain.
Return ONLY valid JSON.

Exact output:

{
  "calculation_type": "...",
  "values": {},
  "missing": [],
  "detected_language": "en"
}

Allowed calculation_type:

percentage_of:
{base, percent}

percentage_change:
{from, to}

profit_loss:
{cost_price, selling_price}

discount:
{price, discount_percent}

gst:
{amount, rate, mode}

cgst_sgst:
{amount, rate}

simple_interest:
{principal, rate, time_years}

compound_interest:
{principal, rate, time_years, frequency}

emi:
{principal, rate_annual, tenure_months}

area_rectangle:
{length, width}

area_square:
{side}

area_circle:
{radius}

area_triangle:
{base, height}

ratio:
{a, b}

average:
{numbers}

statistics:
{numbers}

bmi:
{weight_kg, height_cm}

age:
{dob, ref_date}

date_difference:
{date1, date2}

marks_percentage:
{obtained, total_marks}

commission:
{sale_amount, commission_percent}

salary_convert:
{value, from}

break_even:
{fixed_cost, price_per_unit, variable_cost_per_unit}

unit_convert:
{value, from_unit, to_unit, category}

unknown

NUMBER RULES:

"2 lakh" = 200000
"5 crore" = 50000000
"25,000" = 25000
"5000 rupees" = 5000
"18%" = 18

COMPOUND INTEREST:

frequency MUST be numeric:

annual/yearly = 1
half-yearly/semi-annually = 2
quarterly = 4
monthly = 12
weekly = 52
daily = 365

If compound interest does not specify frequency, DEFAULT frequency = 1.

Examples:

"10000 par 8% compound interest 3 saal"
= principal 10000, rate 8, time_years 3, frequency 1

"10000 par 8% compound interest 3 saal monthly"
= frequency 12

"10000 par 8% compound interest 3 saal quarterly"
= frequency 4

"10000 par 8% compound interest 3 saal yearly"
= frequency 1

LANGUAGE:

English = en

Hindi written in Devanagari = hi

Hindi written using English/Roman letters or mixed Hindi-English = hinglish

Examples:

"What is 20% of 10000?"
= en

"10000 का 20% कितना होगा?"
= hi

"10000 ka 20% kitna hoga?"
= hinglish

MISSING DATA:

If required information is genuinely missing, put short descriptions in "missing".

Use the same language as detected_language.

For compound interest, frequency is NOT missing if it is absent because annual frequency must be assumed.

Never return markdown.
Never return code fences.
Never return extra text.
`;

// ============================================================
// HELPER:
// NORMALIZE COMPOUND INTEREST FREQUENCY
// ============================================================

function normalizeFrequency(value) {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0
  ) {
    return value;
  }

  if (
    typeof value !== 'string'
  ) {
    return 1;
  }

  const text =
    value
      .trim()
      .toLowerCase();

  if (
    text.includes('month')
  ) {
    return 12;
  }

  if (
    text.includes('quarter')
  ) {
    return 4;
  }

  if (
    text.includes('half') ||
    text.includes('semi')
  ) {
    return 2;
  }

  if (
    text.includes('week')
  ) {
    return 52;
  }

  if (
    text.includes('day') ||
    text.includes('daily')
  ) {
    return 365;
  }

  if (
    text.includes('year') ||
    text.includes('annual')
  ) {
    return 1;
  }

  const numeric =
    Number(text);

  if (
    Number.isFinite(numeric) &&
    numeric > 0
  ) {
    return numeric;
  }

  // Default = annual compounding
  return 1;
}

// ============================================================
// HELPER:
// NORMALIZE CLASSIFICATION
// ============================================================

function normalizeClassification(classification) {
  if (
    !classification ||
    typeof classification !== 'object'
  ) {
    return classification;
  }

  if (
    !classification.values ||
    typeof classification.values !== 'object'
  ) {
    classification.values = {};
  }

  if (
    !Array.isArray(
      classification.missing
    )
  ) {
    classification.missing = [];
  }

  // ----------------------------------------------------------
  // COMPOUND INTEREST
  // ----------------------------------------------------------

  if (
    classification.calculation_type ===
    'compound_interest'
  ) {
    const values =
      classification.values;

    // Principal
    if (
      typeof values.principal === 'string'
    ) {
      const number =
        Number(
          values.principal
            .replace(/,/g, '')
            .replace(/[₹$€£]/g, '')
            .trim()
        );

      if (Number.isFinite(number)) {
        values.principal = number;
      }
    }

    // Rate
    if (
      typeof values.rate === 'string'
    ) {
      const number =
        Number(
          values.rate
            .replace('%', '')
            .trim()
        );

      if (Number.isFinite(number)) {
        values.rate = number;
      }
    }

    // Time
    if (
      typeof values.time_years === 'string'
    ) {
      const number =
        Number(
          values.time_years
            .replace(/years?/i, '')
            .replace(/saal/gi, '')
            .trim()
        );

      if (Number.isFinite(number)) {
        values.time_years = number;
      }
    }

    // Frequency
    values.frequency =
      normalizeFrequency(
        values.frequency
      );

    // --------------------------------------------------------
    // Frequency should NEVER remain missing
    // because annual is our default.
    // --------------------------------------------------------

    classification.missing =
      classification.missing.filter(
        (item) =>
          !String(item)
            .toLowerCase()
            .includes('frequency')
      );
  }

  return classification;
}

// ============================================================
// GROQ CLASSIFICATION
// ============================================================

app.post(
  '/api/classify',
  async (req, res) => {

    try {

      const {
        question
      } = req.body || {};

      // ------------------------------------------------------
      // VALIDATE QUESTION
      // ------------------------------------------------------

      if (
        !question ||
        typeof question !== 'string'
      ) {
        return res.status(400).json({
          error:
            'A "question" string is required.'
        });
      }

      const cleanQuestion =
        question.trim();

      if (!cleanQuestion) {
        return res.status(400).json({
          error:
            'Question cannot be empty.'
        });
      }

      // ------------------------------------------------------
      // API KEY
      // ------------------------------------------------------

      const apiKey =
        process.env.GROQ_API_KEY;

      if (!apiKey) {

        console.error(
          'GROQ_API_KEY is missing.'
        );

        return res.status(500).json({
          error:
            'Server is missing GROQ_API_KEY. Add it in Render Environment Variables.'
        });
      }

      const cleanKey =
        apiKey.trim();

      // ------------------------------------------------------
      // MODEL
      // ------------------------------------------------------

      const model =
        process.env.GROQ_MODEL ||
        'openai/gpt-oss-20b';

      console.log(
        `Groq model: ${model}`
      );

      console.log(
        `Question length: ${cleanQuestion.length}`
      );

      // ------------------------------------------------------
      // GROQ REQUEST
      // ------------------------------------------------------

      const requestBody = {

        model,

        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: cleanQuestion
          }
        ],

        // ----------------------------------------------------
        // GPT-OSS reasoning:
        // Keep reasoning LOW because this app only needs
        // classification, not long reasoning.
        // ----------------------------------------------------

        reasoning_effort: 'low',

        include_reasoning: false,

        temperature: 0,

        // Small output = lower token usage.
        max_completion_tokens: 300,

        // JSON mode
        response_format: {
          type: 'json_object'
        }
      };

      // ------------------------------------------------------
      // GROQ API CALL
      // ------------------------------------------------------

      const groqRes =
        await fetchFn(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',

              Authorization:
                `Bearer ${cleanKey}`
            },

            body:
              JSON.stringify(
                requestBody
              )
          }
        );

      // ------------------------------------------------------
      // RATE LIMIT / ERROR
      // ------------------------------------------------------

      if (!groqRes.ok) {

        const rawErrText =
          await groqRes.text();

        let parsedErr = null;

        try {
          parsedErr =
            JSON.parse(
              rawErrText
            );
        } catch (_) {
          // Not JSON
        }

        console.error(
          '============================================'
        );

        console.error(
          'Groq API ERROR'
        );

        console.error(
          'HTTP:',
          groqRes.status,
          groqRes.statusText
        );

        console.error(
          'MODEL:',
          model
        );

        console.error(
          'RESPONSE:',
          rawErrText
        );

        console.error(
          '============================================'
        );

        const errMessage =
          parsedErr?.error?.message ||
          rawErrText ||
          'No details returned by Groq.';

        // ----------------------------------------------------
        // 429 RATE LIMIT
        // ----------------------------------------------------

        if (
          groqRes.status === 429
        ) {

          const retryAfter =
            groqRes.headers.get(
              'retry-after'
            );

          const remainingTokens =
            groqRes.headers.get(
              'x-ratelimit-remaining-tokens'
            );

          const limitTokens =
            groqRes.headers.get(
              'x-ratelimit-limit-tokens'
            );

          return res.status(429).json({

            error:
              'Groq API rate limit reached. Please wait a moment and try again.',

            provider:
              'groq',

            status:
              429,

            retryAfter:
              retryAfter || null,

            rateLimitTokens:
              limitTokens || null,

            remainingTokens:
              remainingTokens || null,

            details:
              errMessage
          });
        }

        // ----------------------------------------------------
        // AUTH
        // ----------------------------------------------------

        if (
          groqRes.status === 401 ||
          groqRes.status === 403
        ) {

          return res.status(502).json({

            error:
              'Groq API authentication failed. Check GROQ_API_KEY in Render.',

            provider:
              'groq',

            status:
              groqRes.status
          });
        }

        // ----------------------------------------------------
        // OTHER ERROR
        // ----------------------------------------------------

        return res.status(502).json({

          error:
            `Groq API error (${groqRes.status}): ${errMessage}`,

          provider:
            'groq',

          status:
            groqRes.status
        });
      }

      // ------------------------------------------------------
      // READ RESPONSE
      // ------------------------------------------------------

      const data =
        await groqRes.json();

      const generatedText =
        data?.choices?.[0]?.message?.content;

      if (
        !generatedText ||
        typeof generatedText !== 'string'
      ) {

        console.error(
          'Unexpected Groq response:',
          JSON.stringify(data)
        );

        return res.status(502).json({
          error:
            'Groq returned an empty or unexpected response.'
        });
      }

      // ------------------------------------------------------
      // CLEAN JSON
      // ------------------------------------------------------

      let classificationText =
        generatedText.trim();

      classificationText =
        classificationText
          .replace(
            /^```json\s*/i,
            ''
          )
          .replace(
            /^```\s*/i,
            ''
          )
          .replace(
            /\s*```$/i,
            ''
          )
          .trim();

      // ------------------------------------------------------
      // PARSE JSON
      // ------------------------------------------------------

      let classification;

      try {

        classification =
          JSON.parse(
            classificationText
          );

      } catch (parseError) {

        console.error(
          'Invalid JSON from Groq:',
          classificationText
        );

        return res.status(502).json({
          error:
            'Groq returned invalid JSON. Please try again.',
          provider:
            'groq'
        });
      }

      // ------------------------------------------------------
      // BASIC VALIDATION
      // ------------------------------------------------------

      if (
        !classification ||
        typeof classification !== 'object'
      ) {

        return res.status(502).json({
          error:
            'Groq returned an invalid classification object.'
        });
      }

      if (
        !classification.calculation_type
      ) {

        return res.status(502).json({
          error:
            'Groq response is missing calculation_type.'
        });
      }

      // ------------------------------------------------------
      // NORMALIZE
      // ------------------------------------------------------

      classification =
        normalizeClassification(
          classification
        );

      // ------------------------------------------------------
      // LANGUAGE
      // ------------------------------------------------------

      if (
        ![
          'hi',
          'hinglish',
          'en'
        ].includes(
          classification.detected_language
        )
      ) {

        classification.detected_language =
          'en';
      }

      // ------------------------------------------------------
      // FRONTEND COMPATIBLE RESPONSE
      // ------------------------------------------------------

      return res.json({

        content: [
          {
            type: 'text',

            text:
              JSON.stringify(
                classification
              )
          }
        ],

        provider:
          'groq',

        model,

        // Useful debugging metadata.
        // Does NOT expose API key.
        usage: {
          prompt_tokens:
            data?.usage?.prompt_tokens ??
            null,

          completion_tokens:
            data?.usage?.completion_tokens ??
            null,

          total_tokens:
            data?.usage?.total_tokens ??
            null
        }
      });

    } catch (err) {

      console.error(
        'Unexpected server error:',
        err
      );

      return res.status(500).json({

        error:
          'Something went wrong on the server. Please try again.'
      });
    }
  }
);

// ============================================================
// UNKNOWN API ROUTE
// ============================================================

app.use(
  '/api',
  (req, res) => {

    res.status(404).json({
      error:
        `No API route: ${req.method} ${req.originalUrl}`
    });
  }
);

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use(
  (err, req, res, next) => {

    console.error(
      'Unhandled error:',
      err
    );

    res.status(500).json({
      error:
        'Unexpected server error.'
    });
  }
);

// ============================================================
// START SERVER
// ============================================================

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {

    console.log(
      `AI Calculator server running on port ${PORT}`
    );

    console.log(
      'AI Provider: Groq'
    );

    console.log(
      `AI Model: ${
        process.env.GROQ_MODEL ||
        'openai/gpt-oss-20b'
      }`
    );

    console.log(
      'Compound frequency normalization: ENABLED'
    );

    console.log(
      'Reasoning effort: LOW'
    );
  }
);