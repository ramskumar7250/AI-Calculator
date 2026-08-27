const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// Node 18+ has fetch built in.
// Fallback for environments where fetch is unavailable.
const fetchFn =
  globalThis.fetch ||
  ((...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args)));


// ============================================================
// BASIC APP SETUP
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
// PUBLIC FOLDER
// ============================================================

const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');


// Serve files from /public
app.use(express.static(PUBLIC_DIR));


// ============================================================
// DEBUG FILES
// ============================================================

app.get('/api/debug-files', (req, res) => {
  try {
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
  } catch (error) {
    console.error('Debug files error:', error);

    res.status(500).json({
      error: 'Unable to inspect deployed files.',
      message: error.message
    });
  }
});


// ============================================================
// DEBUG API KEY
// ============================================================
// IMPORTANT:
// This NEVER returns the complete API key.
// It only shows whether it exists, its length,
// first 7 characters and whether format looks correct.
// ============================================================

app.get('/api/debug-key', (req, res) => {
  try {
    const raw = process.env.ANTHROPIC_API_KEY;

    if (!raw) {
      return res.json({
        readFrom: 'process.env.ANTHROPIC_API_KEY',
        exists: false,
        length: 0,
        lengthAfterTrim: 0,
        hadSurroundingWhitespace: false,
        prefix: '',
        looksLikeAnthropicFormat: false,
        note:
          'ANTHROPIC_API_KEY is NOT available on this running Render instance.'
      });
    }

    const trimmed = raw.trim();

    res.json({
      readFrom: 'process.env.ANTHROPIC_API_KEY',

      exists: true,

      length: raw.length,

      lengthAfterTrim: trimmed.length,

      hadSurroundingWhitespace:
        raw.length !== trimmed.length,

      prefix: raw.slice(0, 7),

      looksLikeAnthropicFormat:
        trimmed.startsWith('sk-ant-'),

      note: trimmed.startsWith('sk-ant-')
        ? 'API key prefix looks like an Anthropic key.'
        : 'WARNING: The value does not start with sk-ant-. Check Render Environment Variables.'
    });

  } catch (error) {
    console.error('Debug key error:', error);

    res.status(500).json({
      error: 'Unable to inspect API key.',
      message: error.message
    });
  }
});


// ============================================================
// HOME PAGE
// ============================================================

app.get('/', (req, res) => {
  if (fs.existsSync(INDEX_FILE)) {
    return res.sendFile(INDEX_FILE);
  }

  return res.status(500).json({
    error:
      'public/index.html was not found on the server.',
    lookedIn: INDEX_FILE,

    hint:
      'Make sure public/index.html exists in GitHub and is committed to the main branch.'
  });
});


// ============================================================
// HEALTH CHECK
// ============================================================

function healthCheck(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  res.json({
    status: 'ok',

    hasApiKey: !!apiKey,

    apiKeyLooksValid:
      !!apiKey && apiKey.trim().startsWith('sk-ant-'),

    time: new Date().toISOString()
  });
}

app.get('/health', healthCheck);

app.get('/api/health', healthCheck);


// ============================================================
// SYSTEM PROMPT
// ============================================================

const SYSTEM_PROMPT = `
You are the natural-language understanding layer for a calculator app used by people typing in English, Hindi, or Hinglish.

Your ONLY job is to read the user's question and output ONE JSON object identifying the calculation type and extracting the numeric inputs.

You do NOT calculate anything yourself.

Output ONLY the JSON object.
Do not use markdown.
Do not add explanations outside the JSON object.

Pick "calculation_type" from exactly this list:

- percentage_of: {base, percent}

- percentage_change: {from, to}

- profit_loss: {cost_price, selling_price}

- discount: {price, discount_percent}

- gst: {amount, rate, mode}
  mode must be:
  "exclusive" = add GST
  "inclusive" = extract GST from total

- cgst_sgst: {amount, rate}
  rate is the TOTAL GST rate to be split equally into CGST + SGST

- simple_interest: {principal, rate, time_years}

- compound_interest: {principal, rate, time_years, frequency}
  frequency = times compounded per year
  default = 1

- emi: {principal, rate_annual, tenure_months}

- area_rectangle: {length, width}

- area_square: {side}

- area_circle: {radius}

- area_triangle: {base, height}

- ratio: {a, b}

- average: {numbers}

- statistics: {numbers}

- bmi: {weight_kg, height_cm}

- age: {dob, ref_date}

- date_difference: {date1, date2}

- marks_percentage: {obtained, total_marks}

- commission: {sale_amount, commission_percent}

- salary_convert: {value, from}

- break_even: {fixed_cost, price_per_unit, variable_cost_per_unit}

- unit_convert:
  {value, from_unit, to_unit, category}

  category must be one of:
  length
  weight
  volume
  temperature
  time

- unknown

Convert units the user gives into plain numeric values.

Examples:

"2 lakh" -> 200000

"12 feet" -> 12

Do not convert feet to meters unless the user specifically asks.

Language detection:

- "hi" = Hindi written in Devanagari script
- "en" = English
- "hinglish" = Hindi words written using Roman/Latin letters
  or mixed English + Hindi

Examples:

"10000 ka 20% kitna hoga"
=> hinglish

"10000 का 20% कितना होगा"
=> hi

"What is 20 percent of 10000?"
=> en

If required numbers are missing:

Still return the correct calculation_type.

Fill in whatever values are available.

Add a "missing" array containing short descriptions of what is needed.

The missing text must be written in the same language as detected_language.

Return strictly valid JSON in exactly this shape:

{
  "calculation_type": "...",
  "values": {},
  "missing": [],
  "detected_language": "hi"
}

Do not return anything else.
`;


// ============================================================
// ANTHROPIC CLASSIFICATION API
// ============================================================

app.post('/api/classify', async (req, res) => {

  try {

    // --------------------------------------------------------
    // Validate request
    // --------------------------------------------------------

    const { question } = req.body || {};

    if (!question || typeof question !== 'string') {
      return res.status(400).json({
        error: 'A "question" string is required.'
      });
    }


    // --------------------------------------------------------
    // Get API key
    // --------------------------------------------------------

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error:
          'Server is missing ANTHROPIC_API_KEY. Add it in Render Environment Variables.'
      });
    }


    // Remove accidental spaces/newlines
    const cleanKey = apiKey.trim();

    console.log(
      `Using ANTHROPIC_API_KEY: length=${cleanKey.length}, prefix=${cleanKey.slice(
        0,
        7
      )}..., trimmed=${cleanKey !== apiKey}`
    );


    // --------------------------------------------------------
    // Anthropic request
    // --------------------------------------------------------

    const requestBody = {

      model: 'claude-haiku-4-5-20251001',

      max_tokens: 1000,

      system: SYSTEM_PROMPT,

      messages: [
        {
          role: 'user',
          content: question
        }
      ]
    };


    console.log(
      'Sending request to Anthropic:',
      requestBody.model
    );


    const anthropicRes = await fetchFn(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',

          'x-api-key': cleanKey,

          'anthropic-version': '2023-06-01'
        },

        body: JSON.stringify(requestBody)
      }
    );


    // --------------------------------------------------------
    // Handle Anthropic errors
    // --------------------------------------------------------

    if (!anthropicRes.ok) {

      const rawErrText = await anthropicRes.text();

      let parsedErr = null;

      try {
        parsedErr = JSON.parse(rawErrText);
      } catch (_) {
        // Response wasn't JSON
      }


      console.error(
        '========================================'
      );

      console.error(
        'ANTHROPIC API CALL FAILED'
      );

      console.error(
        'HTTP STATUS:',
        anthropicRes.status
      );

      console.error(
        'STATUS TEXT:',
        anthropicRes.statusText
      );

      console.error(
        'MODEL:',
        requestBody.model
      );

      console.error(
        'ANTHROPIC RESPONSE:',
        rawErrText
      );

      console.error(
        '========================================'
      );


      const errType =
        parsedErr?.error?.type ||
        'unknown_error';

      const errMessage =
        parsedErr?.error?.message ||
        rawErrText ||
        'No details returned by Anthropic.';


      return res.status(502).json({

        error:
          `Anthropic API error (${anthropicRes.status} ${errType}): ${errMessage}`,

        anthropicStatus:
          anthropicRes.status,

        anthropicErrorType:
          errType

      });
    }


    // --------------------------------------------------------
    // Successful response
    // --------------------------------------------------------

    const data = await anthropicRes.json();

    console.log(
      'Anthropic API request successful.'
    );

    return res.json(data);

  } catch (error) {

    console.error(
      'SERVER ERROR:',
      error
    );

    return res.status(500).json({

      error:
        'Something went wrong on the server.',

      message:
        error.message

    });
  }
});


// ============================================================
// UNKNOWN API ROUTES
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
    `Public directory: ${PUBLIC_DIR}`
  );

  console.log(
    `Index file: ${INDEX_FILE}`
  );

});