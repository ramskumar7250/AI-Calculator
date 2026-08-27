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

============================================================
CALCULATION TYPES
============================================================

Pick "calculation_type" from exactly this list:

- percentage_of: {base, percent}

- percentage_change: {from, to}

- profit_loss: {cost_price, selling_price}

- discount: {price, discount_percent}

- gst: {amount, rate, mode}
  mode must be exactly:
  "exclusive" or "inclusive"

  exclusive = GST needs to be added to the amount.

  inclusive = GST is already included in the amount
  and the base price and GST portion need to be extracted.

- cgst_sgst: {amount, rate}
  rate is the TOTAL GST rate.
  It must be split equally into CGST and SGST.

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


============================================================
IMPORTANT COMPOUND INTEREST RULE
============================================================

Compound interest questions require a compounding frequency such as:

- annual
- yearly
- half-yearly
- quarterly
- monthly
- weekly
- daily

HOWEVER:

If the user asks a compound-interest question and DOES NOT specify
the compounding frequency, DO NOT ask the user for the frequency.

Instead:

ASSUME ANNUAL COMPOUNDING.

Set:

"frequency": "annual"

and continue normally.

Do NOT put compounding frequency inside the "missing" array
when it is not provided.

Example:

User:
"10000 par 8% compound interest 3 saal ka"

Correct classification:

{
  "calculation_type": "compound_interest",
  "values": {
    "principal": 10000,
    "rate": 8,
    "time_years": 3,
    "frequency": "annual"
  },
  "missing": [],
  "detected_language": "hinglish"
}

Also clearly understand these:

"8% compound interest on 10000 for 3 years"
=> frequency = "annual"

"10000 par 8% CI 3 years monthly"
=> frequency = "monthly"

"10000 par 8% compound interest 3 saal quarterly"
=> frequency = "quarterly"

"10000 par 8% compound interest 3 saal half yearly"
=> frequency = "half-yearly"

"10000 par 8% compound interest 3 saal daily"
=> frequency = "daily"

If frequency is not mentioned:
ALWAYS use "annual".

Never return:
"frequency required"
or
"frequency is missing"
for a normal compound-interest question.


============================================================
NUMBER RULES
============================================================

Convert common number formats into plain numeric values.

Examples:

"2 lakh" -> 200000

"5 crore" -> 50000000

"25,000" -> 25000

"5000 rupees" -> 5000

"₹5000" -> 5000

"18%" -> 18

"12 feet" -> 12

"20.5" -> 20.5

"1.5 lakh" -> 150000


============================================================
INDIAN NUMBERING
============================================================

Understand Indian numbering terms such as:

lakh
lakhs
lac
crore
crores
k
thousand

Examples:

"1 lakh" -> 100000

"2 lakh" -> 200000

"10 lakh" -> 1000000

"1 crore" -> 10000000

"2 crore" -> 20000000

"50k" -> 50000


============================================================
CURRENCY
============================================================

Understand:

₹
Rs
Rs.
INR
rupee
rupees
रुपये
रुपया

Currency symbols and words should NOT become part of numeric values.

Example:

"₹25,000 ka 18%" -> base = 25000

"50000 rupees par 10% discount"
-> price = 50000


============================================================
LANGUAGE DETECTION
============================================================

"hi"
=
Hindi written in Devanagari script.

"en"
=
normal English.

"hinglish"
=
Hindi written using Roman/Latin letters,
or mixed English + Hindi.

Examples:

"10000 ka 20% kitna hoga"
=> hinglish

"10000 का 20% कितना होगा"
=> hi

"What is 20% of 10000?"
=> en

"25000 par 18 percent GST kitna hoga"
=> hinglish

"₹10000 में 18% GST शामिल है"
=> hi


============================================================
GST UNDERSTANDING
============================================================

Understand the difference between GST exclusive and GST inclusive.

Examples:

"25000 par 18% GST add karo"
=> gst
=> mode = "exclusive"

"25000 + 18% GST"
=> gst
=> mode = "exclusive"

"25000 mein 18% GST included hai"
=> gst
=> mode = "inclusive"

"10000 including 18% GST original price kya hai"
=> gst
=> mode = "inclusive"

"10000 mein 18 GST included hai base price batao"
=> gst
=> mode = "inclusive"


============================================================
PROFIT AND LOSS
============================================================

Understand:

"10000 mein kharida aur 12500 mein becha profit?"
=> profit_loss

cost_price = 10000
selling_price = 12500

"10000 ka maal 9000 mein becha"
=> loss

"buying price" means cost_price.

"cost price" means cost_price.

"purchase price" means cost_price.

"selling price" means selling_price.

"sold for" means selling_price.


============================================================
DISCOUNT
============================================================

Understand:

"50000 par 15% discount"
=> price = 50000
=> discount_percent = 15

"50000 ka 15 percent discount ke baad price"
=> discount

"₹50000 पर 15% discount"
=> discount


============================================================
INTEREST
============================================================

Simple interest:

"10000 par 8% simple interest 3 saal"
=> simple_interest

Compound interest:

"10000 par 8% compound interest 3 saal"
=> compound_interest
=> frequency = "annual"

Never confuse simple interest with compound interest.


============================================================
AREA
============================================================

For rectangle:

"20 feet long aur 15 feet wide"
=> area_rectangle

length = 20
width = 15

For square:

"side 10 feet"
=> area_square

side = 10

For circle:

"radius 7"
=> area_circle

radius = 7

For triangle:

"base 10 height 5"
=> area_triangle

base = 10
height = 5

For area calculations, preserve the original unit meaning.

Do NOT unnecessarily convert feet into meters.


============================================================
EMI
============================================================

Understand:

"5 lakh loan 10% interest 5 years EMI"
=> emi

principal = 500000

rate_annual = 10

tenure_months = 60

If the user gives years for loan tenure,
convert years to months.

Example:

"5 lakh loan 10% for 5 years"
=> tenure_months = 60


============================================================
PERCENTAGE
============================================================

"25000 ka 18% kitna hai?"
=> percentage_of

base = 25000
percent = 18

"18% of 25000"
=> percentage_of

base = 25000
percent = 18


============================================================
PERCENTAGE CHANGE
============================================================

"100 se 120 hua percentage increase?"
=> percentage_change

from = 100
to = 120


============================================================
MISSING INFORMATION
============================================================

If required information is genuinely missing,
still return the correct calculation_type.

Fill whatever values are available.

Then add a "missing" array containing short descriptions
of what is required.

IMPORTANT:

Do NOT mark compound-interest frequency as missing.

For compound interest, if frequency is absent:
use "annual".

Only mark information as missing when it is genuinely required
and cannot reasonably be assumed.

Examples:

"compound interest on 10000"
=> calculation_type = compound_interest

missing may contain:
"rate"
"time"

But NOT:
"frequency"

Because frequency defaults to annual.


============================================================
MISSING LANGUAGE
============================================================

The missing messages MUST be written in the SAME language
as detected_language.

Hindi question:
missing message must be Hindi.

English question:
missing message must be English.

Hinglish question:
missing message must be Hinglish.


============================================================
UNKNOWN QUESTIONS
============================================================

If the question is not related to a supported calculation,
use:

"calculation_type": "unknown"

Do not invent numeric values.

Do not pretend a calculation type when the user's question
is clearly unrelated to calculation.


============================================================
OUTPUT FORMAT
============================================================

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

The "missing" value must always be an array.

The "values" value must always be an object.

Never return markdown.

Never return explanations outside JSON.

Never return multiple JSON objects.


============================================================
FINAL BEHAVIOR
============================================================

Be decisive.

Do not unnecessarily ask follow-up questions.

Extract all information available from the user's question.

For common calculator questions, classify them directly.

For compound interest without a stated frequency,
ALWAYS assume annual compounding.

The goal is to make the calculator feel simple:

USER ASKS -> UNDERSTAND -> CLASSIFY -> RETURN JSON

Do not make the user choose a calculator manually.
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
    // COMPOUND INTEREST SAFETY FALLBACK
    //
    // If Groq somehow forgets the annual default,
    // the backend enforces it here.
    // --------------------------------------------------------

    if (
      classification.calculation_type ===
      'compound_interest'
    ) {
      if (
        !classification.values.frequency ||
        typeof classification.values.frequency !==
          'string'
      ) {
        classification.values.frequency =
          'annual';
      }

      // Remove accidental frequency-related missing message.
      classification.missing =
        classification.missing.filter(
          (item) =>
            !/frequency|compounding frequency|compound frequency/i.test(
              String(item)
            )
        );
    }

    // --------------------------------------------------------
    // IMPORTANT:
    // Return an Anthropic-compatible shape so your existing
    // frontend does NOT need to be changed.
    // --------------------------------------------------------

    return res.json({
      content: [
        {
          type: 'text',
          text: JSON.stringify(classification)
        }
      ],

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