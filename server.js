const express = require('express');
const path = require('path');

// Node 18+ has fetch built in. If this is running on an older Node version
// on your host, fall back to node-fetch so the app doesn't crash.
const fetchFn = globalThis.fetch || ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

const app = express();

// Log every request that actually reaches this Express process. If you deploy
// and NEVER see these lines in your Render logs when you hit the site, this
// process isn't the one serving your requests at all (classic symptom: the
// Render service is set up as a "Static Site" instead of a "Web Service",
// so server.js never runs — Render serves the static files directly and
// /api/classify simply doesn't exist, which is what returns that HTML page).
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

// CORS safety net — only matters if the frontend and this backend end up
// deployed as two separate Render services with two different URLs. Set
// ALLOWED_ORIGIN to your frontend's URL in that case; harmless otherwise.
app.use((req, res, next) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.header('Access-Control-Allow-Origin', allowedOrigin);
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Two equivalent health routes (some setups check /health, others /api/health).
// Both must return JSON. If opening either of these in your browser shows
// anything other than JSON (an HTML page, Render's default page, etc.),
// server.js is not the process handling your requests — fix the Render
// service type/settings before touching any code.
function healthCheck(req, res) {
  res.json({
    status: 'ok',
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
    time: new Date().toISOString()
  });
}
app.get('/health', healthCheck);
app.get('/api/health', healthCheck);

const SYSTEM_PROMPT = `You are the natural-language understanding layer for a calculator app used by people typing in English, Hindi, or Hinglish.

Your ONLY job: read the user's question and output ONE JSON object identifying the calculation type and extracting the numeric inputs. You do NOT calculate anything yourself. Output ONLY the JSON object, nothing else — no markdown fences, no explanation text.

Pick "calculation_type" from exactly this list, and fill "values" with exactly these keys (numbers only, no currency symbols/commas/units in the values):

- percentage_of: {base, percent}
- percentage_change: {from, to}
- profit_loss: {cost_price, selling_price}
- discount: {price, discount_percent}
- gst: {amount, rate, mode}   // mode is "exclusive" (add GST) or "inclusive" (extract GST from total)
- cgst_sgst: {amount, rate}   // rate is the TOTAL GST rate to be split equally into CGST + SGST
- simple_interest: {principal, rate, time_years}
- compound_interest: {principal, rate, time_years, frequency}  // frequency = times compounded per year, default 1
- emi: {principal, rate_annual, tenure_months}
- area_rectangle: {length, width}
- area_square: {side}
- area_circle: {radius}
- area_triangle: {base, height}
- ratio: {a, b}
- average: {numbers}   // array
- statistics: {numbers}   // array — returns mean, median, mode, range
- bmi: {weight_kg, height_cm}
- age: {dob, ref_date}  // ISO date strings YYYY-MM-DD. ref_date optional, omit to use today.
- date_difference: {date1, date2}  // ISO date strings YYYY-MM-DD
- marks_percentage: {obtained, total_marks}
- commission: {sale_amount, commission_percent}
- salary_convert: {value, from}  // from is "monthly" or "annual"
- break_even: {fixed_cost, price_per_unit, variable_cost_per_unit}
- unit_convert: {value, from_unit, to_unit, category}  // category one of: length, weight, volume, temperature, time
- unknown  // if you genuinely cannot classify it

Convert units the user gives (feet/lakh/crore/kg etc.) into the plain numeric value the schema expects, e.g. "2 lakh" -> 200000, "12 feet" -> 12 (unit stays feet, don't convert to meters for area).

Also detect "detected_language": "hi" if the question is written in Hindi (Devanagari script), "en" if it's in plain English, or "hinglish" if it's Hindi words written in Roman/Latin script or mixed English+Hindi (e.g. "10000 ka 20% kitna hoga"). This matters because the app must reply to the user in the same language they asked in.

If required numbers are missing for the type you picked, still return that calculation_type, fill in what you have, and add a "missing" array of short field-description strings, written in the SAME language as detected_language (Hindi question -> Hindi missing-field text, English question -> English missing-field text, Hinglish question -> Hinglish text), asking for what's needed.

Respond with strictly valid JSON in this shape:
{"calculation_type": "...", "values": {...}, "missing": [], "detected_language": "hi" | "hinglish" | "en"}`;

app.post('/api/classify', async (req, res) => {
  try {
    const { question } = req.body || {};
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'A "question" string is required.' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Server is missing ANTHROPIC_API_KEY. Add it in your hosting provider\'s environment variables.'
      });
    }

    const anthropicRes = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: question }]
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic API error:', anthropicRes.status, errText);
      return res.status(502).json({ error: 'The AI service returned an error. Please try again.' });
    }

    const data = await anthropicRes.json();
    res.json(data);
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  }
});

// Any /api/* route that doesn't exist -> JSON 404 (not Express's default HTML page)
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No API route: ${req.method} ${req.originalUrl}` });
});

// Catch-all error handler -> always JSON, never an HTML stack trace page
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI Calculator server running on port ${PORT}`));