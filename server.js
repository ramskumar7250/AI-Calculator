const express = require('express');
const path = require('path');
const fs = require('fs');

// Node 18+ has fetch built in.
// Fallback to node-fetch for older Node versions.
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
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';

  res.header('Access-Control-Allow-Origin', allowedOrigin);
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

app.use(express.json());

// ============================================================
// FRONTEND / PUBLIC DIRECTORY
// ============================================================

const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');

app.use(express.static(PUBLIC_DIR));

// ============================================================
// DEBUG FILES
// ============================================================

app.get('/api/debug-files', (req, res) => {
  res.json({
    __dirname,
    PUBLIC_DIR,
    INDEX_FILE,
    publicDirExists: fs.existsSync(PUBLIC_DIR),
    indexFileExists: fs.existsSync(INDEX_FILE),
    rootContents: fs.existsSync(__dirname)
      ? fs.readdirSync(__dirname)
      : [],
    publicContents: fs.existsSync(PUBLIC_DIR)
      ? fs.readdirSync(PUBLIC_DIR)
      : []
  });
});

// ============================================================
// ROOT ROUTE
// ============================================================

app.get('/', (req, res) => {
  if (fs.existsSync(INDEX_FILE)) {
    return res.sendFile(INDEX_FILE);
  }

  return res.status(500).json({
    error:
      'public/index.html was not found on the server at deploy time.',
    lookedIn: INDEX_FILE,
    hint:
      'Visit /api/debug-files on this same domain to inspect deployed files.'
  });
});

// ============================================================
// HEALTH CHECK
// ============================================================

function healthCheck(req, res) {
  res.json({
    status: 'ok',
    provider: 'groq',
    hasApiKey: !!process.env.GROQ_API_KEY,
    model:
      process.env.GROQ_MODEL ||
      'openai/gpt-oss-20b',
    time: new Date().toISOString()
  });
}

app.get('/health', healthCheck);
app.get('/api/health', healthCheck);

// ============================================================
// SAFE GROQ KEY DEBUG
// NEVER RETURNS THE ACTUAL API KEY
// ============================================================

app.get('/api/debug-key', (req, res) => {
  const raw = process.env.GROQ_API_KEY;

  if (!raw) {
    return res.json({
      readFrom: 'process.env.GROQ_API_KEY',
      exists: false,
      note:
        'GROQ_API_KEY is not available on this running instance. Check Render Environment Variables and redeploy.'
    });
  }

  const trimmed = raw.trim();

  res.json({
    readFrom: 'process.env.GROQ_API_KEY',
    exists: true,
    length: raw.length,
    lengthAfterTrim: trimmed.length,
    hadSurroundingWhitespace:
      raw.length !== trimmed.length,
    prefix: trimmed.slice(0, 7),
    looksLikeGroqFormat:
      trimmed.startsWith('gsk_'),
    note: trimmed.startsWith('gsk_')
      ? 'The key format looks like a Groq API key.'
      : 'WARNING: The key does not look like the usual Groq gsk_ format. Check the copied value.'
  });
});

// ============================================================
// SYSTEM PROMPT
// ============================================================

const SYSTEM_PROMPT = `
You are the natural-language understanding layer for a calculator app used by people typing in English, Hindi, or Hinglish.

Your ONLY job is to read the user's question and output ONE valid JSON object identifying the calculation type and extracting the numeric inputs.

You DO NOT calculate anything yourself.

Output ONLY valid JSON.
Do NOT use markdown.
Do NOT use code fences.
Do NOT add explanations outside the JSON.

Pick "calculation_type" from exactly this list:

- percentage_of: {base, percent}
- percentage_change: {from, to}
- profit_loss: {cost_price, selling_price}
- discount: {price, discount_percent}
- gst: {amount, rate, mode}
  mode must be "exclusive" or "inclusive"
  exclusive = GST needs to be added
  inclusive = GST is already included and needs to be extracted

- cgst_sgst: {amount, rate}
  rate is the TOTAL GST rate to split equally into CGST + SGST

- simple_interest: {principal, rate, time_years}

- compound_interest:
  {principal, rate, time_years, frequency}

- emi:
  {principal, rate_annual, tenure_months}

- area_rectangle:
  {length, width}

- area_square:
  {side}

- area_circle:
  {radius}

- area_triangle:
  {base, height}

- ratio:
  {a, b}

- average:
  {numbers}

- statistics:
  {numbers}

- bmi:
  {weight_kg, height_cm}

- age:
  {dob, ref_date}

- date_difference:
  {date1, date2}

- marks_percentage:
  {obtained, total_marks}

- commission:
  {sale_amount, commission_percent}

- salary_convert:
  {value, from}

- break_even:
  {fixed_cost, price_per_unit, variable_cost_per_unit}

- unit_convert:
  {value, from_unit, to_unit, category}

- unknown

IMPORTANT NUMBER RULES:

Convert common number formats into plain numeric values.

Examples:

"2 lakh" -> 200000
"5 crore" -> 50000000
"25,000" -> 25000
"5000 rupees" -> 5000
"18%" -> 18
"12 feet" -> 12

For area calculations, keep the original unit meaning.
Do NOT unnecessarily convert feet into meters.

LANGUAGE DETECTION:

"hi"
= Hindi written in Devanagari script.

"en"
= normal English.

"hinglish"
= Hindi written using Roman/Latin letters,
or mixed English + Hindi.

Examples:

"10000 ka 20% kitna hoga"
=> hinglish

"10000 का 20% कितना होगा"
=> hi

"What is 20% of 10000?"
=> en

MISSING INFORMATION:

If required information is missing, still return the correct calculation_type.

Fill whatever values are available.

Then add a "missing" array containing short descriptions of what is required.

The missing messages MUST be written in the SAME language as detected_language.

Hindi question -> Hindi missing message.

English question -> English missing message.

Hinglish question -> Hinglish missing message.

IMPORTANT:

Return this exact top-level structure:

{
  "calculation_type": "...",
  "values": {},
  "missing": [],
  "detected_language": "hi"
}

The detected_language must be exactly one of:

"hi"
"hinglish"
"en"
`;

// ============================================================
// GROQ CLASSIFICATION API
// ============================================================

app.post('/api/classify', async (req, res) => {
  try {
    const { question } = req.body || {};

    // --------------------------------------------------------
    // Validate question
    // --------------------------------------------------------

    if (!question || typeof question !== 'string') {
      return res.status(400).json({
        error: 'A "question" string is required.'
      });
    }

    const cleanQuestion = question.trim();

    if (!cleanQuestion) {
      return res.status(400).json({
        error: 'Question cannot be empty.'
      });
    }

    // --------------------------------------------------------
    // GROQ API KEY
    // --------------------------------------------------------

    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      console.error(
        'GROQ_API_KEY is missing from environment variables.'
      );

      return res.status(500).json({
        error:
          'Server is missing GROQ_API_KEY. Add GROQ_API_KEY in Render Environment Variables.'
      });
    }

    const cleanKey = apiKey.trim();

    // --------------------------------------------------------
    // GROQ MODEL
    // --------------------------------------------------------

    const model =
      process.env.GROQ_MODEL ||
      'openai/gpt-oss-20b';

    console.log(
      `Using Groq model: ${model}`
    );

    console.log(
      `GROQ_API_KEY present: true, length=${cleanKey.length}`
    );

    // --------------------------------------------------------
    // GROQ REQUEST
    // --------------------------------------------------------

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

      temperature: 0,

      max_completion_tokens: 1000,

      response_format: {
        type: 'json_object'
      }
    };

    // --------------------------------------------------------
    // GROQ API CALL
    // --------------------------------------------------------

    const groqRes = await fetchFn(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cleanKey}`
        },

        body: JSON.stringify(requestBody)
      }
    );

    // --------------------------------------------------------
    // GROQ ERROR HANDLING
    // --------------------------------------------------------

    if (!groqRes.ok) {
      const rawErrText = await groqRes.text();

      let parsedErr = null;

      try {
        parsedErr = JSON.parse(rawErrText);
      } catch (_) {
        // Response was not JSON.
      }

      console.error(
        '============================================'
      );

      console.error(
        'Groq API call failed'
      );

      console.error(
        'HTTP status:',
        groqRes.status,
        groqRes.statusText
      );

      console.error(
        'Request model:',
        model
      );

      console.error(
        'Groq response:',
        rawErrText
      );

      console.error(
        '============================================'
      );

      const errMessage =
        parsedErr?.error?.message ||
        rawErrText ||
        'No details returned by Groq.';

      // ------------------------------------------------------
      // RATE LIMIT / QUOTA
      // ------------------------------------------------------

      if (groqRes.status === 429) {
        const retryAfter =
          groqRes.headers.get('retry-after');

        return res.status(429).json({
          error:
            `Groq API rate limit reached. ${errMessage}`,
          provider: 'groq',
          status: 429,
          retryAfter: retryAfter || null
        });
      }

      // ------------------------------------------------------
      // AUTH ERROR
      // ------------------------------------------------------

      if (
        groqRes.status === 401 ||
        groqRes.status === 403
      ) {
        return res.status(502).json({
          error:
            'Groq API authentication failed. Check GROQ_API_KEY in Render Environment Variables.',
          provider: 'groq',
          status: groqRes.status
        });
      }

      // ------------------------------------------------------
      // OTHER GROQ ERRORS
      // ------------------------------------------------------

      return res.status(502).json({
        error:
          `Groq API error (${groqRes.status}): ${errMessage}`,
        provider: 'groq',
        status: groqRes.status
      });
    }

    // --------------------------------------------------------
    // READ GROQ RESPONSE
    // --------------------------------------------------------

    const data = await groqRes.json();

    const generatedText =
      data?.choices?.[0]?.message?.content;

    if (
      !generatedText ||
      typeof generatedText !== 'string'
    ) {
      console.error(
        'Groq returned an unexpected response:',
        JSON.stringify(data)
      );

      return res.status(502).json({
        error:
          'Groq returned an empty or unexpected response.'
      });
    }

    // --------------------------------------------------------
    // CLEAN JSON
    // --------------------------------------------------------

    let classificationText =
      generatedText.trim();

    // Remove accidental markdown fences if model ever adds them.
    classificationText =
      classificationText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    // --------------------------------------------------------
    // VALIDATE JSON
    // --------------------------------------------------------

    let classification;

    try {
      classification =
        JSON.parse(classificationText);
    } catch (parseError) {
      console.error(
        'Groq returned invalid JSON:',
        classificationText
      );

      return res.status(502).json({
        error:
          'Groq returned invalid JSON. Please try the calculation again.',
        provider: 'groq'
      });
    }

    // --------------------------------------------------------
    // BASIC RESPONSE VALIDATION
    // --------------------------------------------------------

    if (
      !classification ||
      typeof classification !== 'object'
    ) {
      return res.status(502).json({
        error:
          'Groq returned an invalid classification object.'
      });
    }

    if (!classification.calculation_type) {
      return res.status(502).json({
        error:
          'Groq response is missing calculation_type.'
      });
    }

    if (!classification.values) {
      classification.values = {};
    }

    if (!Array.isArray(classification.missing)) {
      classification.missing = [];
    }

    if (
      !['hi', 'hinglish', 'en'].includes(
        classification.detected_language
      )
    ) {
      classification.detected_language =
        'en';
    }

    // --------------------------------------------------------
    // IMPORTANT:
    // Return an Anthropic-compatible shape so your existing
    // frontend does NOT need to be changed.
    //
    // Your old backend returned Anthropic data.
    // We now wrap Groq's JSON inside:
    //
    // {
    //   content: [
    //     {
    //       type: "text",
    //       text: "..."
    //     }
    //   ]
    // }
    //
    // --------------------------------------------------------

    return res.json({
      content: [
        {
          type: 'text',
          text: JSON.stringify(classification)
        }
      ],

      // Extra metadata is harmless for the frontend.
      provider: 'groq',
      model
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
});

// ============================================================
// UNKNOWN API ROUTE
// ============================================================

app.use('/api', (req, res) => {
  res.status(404).json({
    error:
      `No API route: ${req.method} ${req.originalUrl}`
  });
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use((err, req, res, next) => {
  console.error(
    'Unhandled error:',
    err
  );

  res.status(500).json({
    error:
      'Unexpected server error.'
  });
});

// ============================================================
// START SERVER
// ============================================================

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `AI Calculator server running on port ${PORT}`
  );

  console.log(
    `AI Provider: Groq`
  );

  console.log(
    `AI Model: ${
      process.env.GROQ_MODEL ||
      'openai/gpt-oss-20b'
    }`
  );
});