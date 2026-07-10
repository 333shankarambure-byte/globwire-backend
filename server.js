// GlobalWire backend — fetches real, live, worldwide news from GDELT's free
// DOC 2.0 API (no API key required, updates every ~15 minutes, covers
// virtually every country and 65+ languages).
//
// Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
//
// Run locally:   npm install && node server.js
// Deploy free:   Glitch.com, Render.com, or Railway.app (see README.md)

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

// ---- Category keywords (GDELT has no fixed categories, so we approximate
// with OR-grouped keyword clusters per sector) ----
const CATEGORY_KEYWORDS = {
  DEFENSE: "(military OR defense OR war OR conflict OR troops)",
  MARKETS: "(economy OR markets OR trade OR stocks OR inflation)",
  ENERGY: "(energy OR oil OR gas OR renewable OR pipeline)",
  POLITICS: "(politics OR election OR government OR parliament OR minister)",
  TECH: "(technology OR AI OR startup OR software OR chip)",
  HEALTH: "(health OR disease OR hospital OR outbreak OR vaccine)",
  SPORTS: "(sports OR football OR cricket OR olympics OR championship)",
};

// ---- Country name -> GDELT sourcecountry token (best-effort common set) ----
const COUNTRY_MAP = {
  "United States": "unitedstates",
  "India": "india",
  "United Kingdom": "unitedkingdom",
  "Germany": "germany",
  "France": "france",
  "China": "china",
  "Japan": "japan",
  "Russia": "russia",
  "Brazil": "brazil",
  "Canada": "canada",
  "Australia": "australia",
  "South Korea": "southkorea",
  "Mexico": "mexico",
  "Italy": "italy",
  "Spain": "spain",
  "Turkey": "turkey",
  "Saudi Arabia": "saudiarabia",
  "Israel": "israel",
  "Iran": "iran",
  "Egypt": "egypt",
  "Nigeria": "nigeria",
  "South Africa": "southafrica",
  "Indonesia": "indonesia",
  "Pakistan": "pakistan",
  "Bangladesh": "bangladesh",
  "Ukraine": "ukraine",
  "Colombia": "colombia",
  "Argentina": "argentina",
  "Philippines": "philippines",
  "Vietnam": "vietnam",
  "Thailand": "thailand",
  "Poland": "poland",
  "Netherlands": "netherlands",
  "Sweden": "sweden",
  "Switzerland": "switzerland",
  "DR Congo": "democraticrepublicofthecongo",
  "Kenya": "kenya",
  "UAE": "unitedarabemirates",
};

// ---- Language name -> GDELT sourcelang token ----
const LANG_MAP = {
  English: "english",
  Hindi: "hindi",
  Spanish: "spanish",
  French: "french",
  Arabic: "arabic",
  Chinese: "chinese",
  Portuguese: "portuguese",
  Russian: "russian",
  German: "german",
  Japanese: "japanese",
  Bengali: "bengali",
  Tamil: "tamil",
  Urdu: "urdu",
  Indonesian: "indonesian",
  Turkish: "turkish",
  Korean: "korean",
};

function buildQuery({ category, country, lang, keyword }) {
  const parts = [];
  if (category && category !== "ALL" && CATEGORY_KEYWORDS[category]) {
    parts.push(CATEGORY_KEYWORDS[category]);
  }
  if (keyword && keyword.trim()) {
    parts.push(keyword.trim());
  }
  if (parts.length === 0) {
    // GDELT requires at least one search term — this broad OR covers general news
    parts.push("(news)");
  }
  if (country && COUNTRY_MAP[country]) {
    parts.push(`sourcecountry:${COUNTRY_MAP[country]}`);
  }
  if (lang && LANG_MAP[lang]) {
    parts.push(`sourcelang:${LANG_MAP[lang]}`);
  }
  return parts.join(" ");
}

async function fetchGdeltWithRetry(urlString, attempt = 1) {
  const gdeltRes = await fetch(urlString, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GlobalWireDecodeDesk/1.0; +https://render.com)",
      "Accept": "application/json",
    },
  });
  if ((gdeltRes.status === 429 || gdeltRes.status === 502 || gdeltRes.status === 503) && attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    return fetchGdeltWithRetry(urlString, attempt + 1);
  }
  return gdeltRes;
}

app.get("/api/news", async (req, res) => {
  try {
    const { category, country, lang, keyword, timespan, maxrecords } = req.query;
    const query = buildQuery({ category, country, lang, keyword });

    const url = new URL(GDELT_BASE);
    url.searchParams.set("query", query);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("sort", "datedesc");
    url.searchParams.set("maxrecords", maxrecords || "25");
    url.searchParams.set("timespan", timespan || "1d");

    const gdeltRes = await fetchGdeltWithRetry(url.toString());

    if (!gdeltRes.ok) {
      return res.status(502).json({
        error: "GDELT request failed after retries",
        status: gdeltRes.status,
        query,
      });
    }

    const raw = await gdeltRes.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      // GDELT occasionally returns non-JSON (e.g. rate limit HTML) — surface it clearly
      return res.status(502).json({ error: "GDELT returned non-JSON response", raw: raw.slice(0, 300), query });
    }

    const articles = (data.articles || []).map((a) => ({
      headline: a.title,
      url: a.url,
      domain: a.domain,
      seendate: a.seendate,
      language: a.language,
      sourcecountry: a.sourcecountry,
      image: a.socialimage || null,
    }));

    res.json({ query, count: articles.length, fetchedAt: new Date().toISOString(), articles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.get("/api/diag", async (req, res) => {
  const results = {};

  // Test 1: can we reach ANY external site at all from this server?
  try {
    const r = await fetch("https://api.github.com/zen");
    results.githubTest = { ok: r.ok, status: r.status };
  } catch (err) {
    results.githubTest = { ok: false, error: err.message, cause: err.cause ? String(err.cause) : null };
  }

  // Test 2: can we reach GDELT specifically?
  try {
    const r = await fetch("https://api.gdeltproject.org/api/v2/doc/doc?query=news&mode=artlist&format=json&maxrecords=1");
    const text = await r.text();
    results.gdeltTest = { ok: r.ok, status: r.status, bodyPreview: text.slice(0, 200) };
  } catch (err) {
    results.gdeltTest = { ok: false, error: err.message, cause: err.cause ? String(err.cause) : null };
  }

  res.json(results);
});

app.get("/api/meta", (req, res) => {
  res.json({
    countries: Object.keys(COUNTRY_MAP).sort(),
    languages: Object.keys(LANG_MAP).sort(),
    categories: Object.keys(CATEGORY_KEYWORDS),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GlobalWire backend running on port ${PORT}`));
