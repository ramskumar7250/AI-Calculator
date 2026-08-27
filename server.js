const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// Node 18+ has fetch built in
const fetchFn =
  globalThis.fetch ||
  ((...args) =>
    import('node-fetch').then(({ default: f }) => f(...args)));


// ============================================================
// BASIC APP SETUP
// ============================================================

app.use((req, res, next) => {
  console.log(
    `${new Date().toISOString()} ${req.method} ${req.originalUrl}`
  );
  next();
});


// CORS safety
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


app.use(express.json());


// ============================================================
// PUBLIC FOLDER
// ============================================================

const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');

app.use(express.static(PUBLIC_DIR));


// ============================================================
// DEBUG FILE ROUTE
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
      'Check that public/index.html exists in GitHub.'
  });
});


// ============================================================
// HEALTH CHECK
// ============================================================

function healthCheck(req, res) {
  res.json({
    status: 'ok',

    hasGeminiApiKey:
      !!process.env.GEMINI_API_KEY,

    time: new Date().toISOString()
  });
}

app.get('/health', healthCheck);
app.get('/api/health', healthCheck);


// ============================================================
// SAFE GEMINI KEY DEBUG
// NEVER SHOWS FULL API KEY
// ============================================================

app.get('/api/debug-key', (req, res) => {
  const raw = process.env.GEMINI_API_KEY;

  if (!raw) {
    return res.json({
      readFrom: 'process.env.GEMINI_API_KEY',
      exists: false,

      note:
        'GEMINI_API_KEY is not available on this running Render instance. Check Render Environment Variables and redeploy.'
    });
  }

  const trimmed = raw.trim();

  return res.json({
    readFrom: 'process.env.GEMINI_API_KEY',

    exists: true,

    length: raw.length,

    lengthAfterTrim: trimmed.length,

    hadSurroundingWhitespace:
      raw.length !== trimmed.length,

    prefix: trimmed.slice(0, 7),

    looksLikeGoogleKey:
      trimmed.length > 10,

    note:
      'The API key exists. Only its prefix and length are shown for security.'
  });
});


// ============================================================
// SYSTEM PROMPT
// ============================================================

const SYSTEM_PROMPT = `
You are the natural-language understanding layer for an AI Calculator app.

The app is used by people typing in:
- English
- Hindi
- Hinglish

Your ONLY job is to read the user's calculation question and identify:
1. calculation_type
2. numeric/input values
3. detected language
4. missing required values

DO NOT calculate the final answer yourself.

Return ONLY valid JSON.
Do not return markdown.
Do not return code fences.
Do not return explanations outside JSON.

Choose calculation_type ONLY from this list:

- percentage_of: {base, percent}

- percentage_change: {from, to}

- profit_loss: {cost_price, selling_price}

- discount: {price, discount_percent}

- gst: {amount, rate, mode}
  mode must be:
  "exclusive"
  or
  "inclusive"

- cgst_sgst: {amount, rate}
  rate is the TOTAL GST rate.

- simple_interest:
  {principal, rate, time_years}

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

Important:

Convert common units/numbers into plain numeric values.

Examples:

"2 lakh" -> 200000

"5 crore" -> 50000000

"12 feet" -> 12

"5000 rupees" -> 5000

For area calculations, keep the original unit meaning.
Do not unnecessarily convert feet into meters.

Language detection:

"hi"
= Hindi written in Devanagari.

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

If required information is missing,
still return the correct calculation_type,
fill whatever values are available,
and add a missing array.

The missing messages must be written in the same language
as detected_language.

Return EXACTLY this JSON structure:

{
  "calculation_type": "...",
  "values": {},
  "missing": [],
  "detected_language": "hi"
}
`;


// ============================================================
// GEMINI API
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


    // --------------------------------------------------------
    // Gemini API Key
    // --------------------------------------------------------

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error:
          'Server is missing GEMINI_API_KEY. Add GEMINI_API_KEY in Render Environment Variables.'
      });
    }

    const cleanKey = apiKey.trim();


    // --------------------------------------------------------
    // Gemini Model
    // --------------------------------------------------------

    const model =
      process.env.GEMINI_MODEL ||
      'gemini-3.7-flash';


    console.log(
      `Using Gemini model: ${model}`
    );

    console.log(
      `GEMINI_API_KEY present: true, length=${cleanKey.length}`
    );


    // --------------------------------------------------------
    // Gemini REST API
    // --------------------------------------------------------

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;


    const requestBody = {
      systemInstruction: {
        parts: [
          {
            text: SYSTEM_PROMPT
          }
        ]
      },

      contents: [
        {
          role: 'user',

          parts: [
            {
              text: question
            }
          ]
        }
      ],

      generationConfig: {
        temperature: 0,

        maxOutputTokens: 1000,

        responseMimeType:
          'application/json'
      }
    };


    const geminiRes = await fetchFn(endpoint, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',

        'x-goog-api-key': cleanKey
      },

      body: JSON.stringify(requestBody)
    });


    // --------------------------------------------------------
    // Gemini Error Handling
    // --------------------------------------------------------

    if (!geminiRes.ok) {

      const rawErrText =
        await geminiRes.text();

      let parsedErr = null;

      try {
        parsedErr =
          JSON.parse(rawErrText);
      } catch (_) {
        // keep raw text
      }


      console.error(
        '======================================'
      );

      console.error(
        'GEMINI API CALL FAILED'
      );

      console.error(
        'HTTP status:',
        geminiRes.status
      );

      console.error(
        'HTTP status text:',
        geminiRes.statusText
      );

      console.error(
        'Model:',
        model
      );

      console.error(
        'Gemini response:',
        rawErrText
      );

      console.error(
        '======================================'
      );


      const errMessage =
        parsedErr?.error?.message ||
        rawErrText ||
        'Gemini returned an unknown error.';


      const errStatus =
        parsedErr?.error?.status ||
        'UNKNOWN';


      return res.status(502).json({
        error:
          `Gemini API error (${geminiRes.status} ${errStatus}): ${errMessage}`,

        geminiStatus:
          geminiRes.status,

        geminiErrorStatus:
          errStatus,

        model
      });
    }


    // --------------------------------------------------------
    // Read Gemini Response
    // --------------------------------------------------------

    const data =
      await geminiRes.json();


    console.log(
      'Gemini API request successful.'
    );


    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || '')
        .join('')
        .trim();


    if (!text) {

      console.error(
        'Gemini returned no text:',
        JSON.stringify(data)
      );

      return res.status(502).json({
        error:
          'Gemini returned an empty response.'
      });
    }


    // --------------------------------------------------------
    // Clean JSON
    // --------------------------------------------------------

    let cleanText = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();


    // Validate JSON before sending it
    try {

      JSON.parse(cleanText);

    } catch (jsonError) {

      console.error(
        'Gemini returned invalid JSON:',
        cleanText
      );

      return res.status(502).json({
        error:
          'Gemini returned invalid JSON. Please try again.'
      });
    }


    // --------------------------------------------------------
    // IMPORTANT:
    // Your existing frontend expects:
    //
    // data.content[0].text
    //
    // So we return Gemini's response in the same
    // structure your old Anthropic frontend expects.
    // --------------------------------------------------------

    return res.json({

      content: [
        {
          type: 'text',

          text: cleanText
        }
      ],

      model,

      provider: 'google-gemini'
    });

  } catch (err) {

    console.error(
      'Server error:',
      err
    );

    return res.status(500).json({
      error:
        'Something went wrong on the server. Please try again.'
    });
  }
});


// ============================================================
// UNKNOWN API ROUTES
// ============================================================

app.use('/api', (req, res) => {

  return res.status(404).json({
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

  return res.status(500).json({
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