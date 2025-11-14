import OpenAI from "openai";

export type TripWindow = {
  start?: string;
  end?: string;
};

export type AISuggestion = {
  name: string;
  search_name: string;
  category?: string;
  note?: string;
  confidence?: number;
  availability?: "year_round" | "seasonal_active" | "seasonal_future";
  priority: number;
};

export const AI_BANNED_NAME_RE =
  /(airport|air\s*base|hospital|clinic|medical|club|stadium|arena|residence|residential|school|university|college|embassy|industrial|logistics|pet\s*(store|shop|care)|bank|office|executive\s+airport|oil\s+field|depot|bridge|shopping\s*mall|mall|hypermarket|supermarket|wholesale|utility|power\s*plant|desalination|gov\.?\s*complex|business\s*park|corporate|data\s*center|island\s*resort|(fish|seafood|wet|meat|produce)\s+market)/i;

const AI_ALLOWED_CATEGORIES = new Set([
  "landmark",
  "museum",
  "cultural",
  "heritage",
  "religious",
  "architecture",
  "experience",
  "entertainment",
  "theme_park",
  "adventure",
  "outdoor",
  "nature",
  "park",
  "garden",
  "beach",
  "wildlife",
  "zoo",
  "aquarium",
  "science",
  "history",
  "observation",
  "waterfront",
  "island",
]);

export const AI_CONFIDENCE_THRESHOLD = 0.75;

const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
let aiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI | null {
  if (!OPENAI_KEY) {
    console.warn("ai-shortlist: missing EXPO_PUBLIC_OPENAI_API_KEY");
    return null;
  }
  if (!aiClient) {
    aiClient = new OpenAI({ apiKey: OPENAI_KEY });
  }
  return aiClient;
}

function normalizeName(value?: string | null) {
  if (!value) return "";
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

export function extractJsonObject(text: string): any | null {
  if (!text) return null;
  let payload = text.trim();
  const fenced = payload.match(/```json[\s\S]*?```/i);
  if (fenced) {
    payload = fenced[0].replace(/```json|```/gi, "").trim();
  }

  try {
    return JSON.parse(payload);
  } catch {
    const start = payload.indexOf("{");
    const end = payload.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      const candidate = payload.slice(start, end + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }
    return null;
  }
}

type FetchParams = {
  cityName?: string;
  countryName?: string;
  lat: number;
  lng: number;
  tripWindow?: TripWindow;
  minResults?: number;
  maxResults?: number;
};

const DEFAULT_MIN = 24;
const DEFAULT_MAX = 36;
const MAX_ATTEMPTS = 4;

export async function fetchAISuggestions(params: FetchParams): Promise<AISuggestion[]> {
  const client = getOpenAIClient();
  if (!client) return [];

  const minResults = params.minResults ?? DEFAULT_MIN;
  const maxResults = params.maxResults ?? DEFAULT_MAX;

  const collected: AISuggestion[] = [];
  const seen = new Set<string>();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && collected.length < minResults; attempt++) {
    const beforeCount = collected.length;
    const remaining = Math.max(Math.min(12, minResults - collected.length), 1);
    const prompt = buildUserPrompt({
      attempt,
      cityName: params.cityName,
      countryName: params.countryName,
      lat: params.lat,
      lng: params.lng,
      tripWindow: params.tripWindow,
      remaining,
      alreadyProvided: collected.map((s) => s.name),
      maxResults,
    });

    const systemPrompt =
      "You are a precise travel assistant. Reply with valid JSON only. Provide high-quality, tourist-ready attractions suitable for first-time visitors.";

    const model = "gpt-5";
    const supportsTemperature = model !== "gpt-5";

    const requestPayload: Parameters<typeof client.chat.completions.create>[0] = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    };

    if (supportsTemperature) {
      requestPayload.temperature = 0.15;
    }

    const response = await client.chat.completions.create(requestPayload);

    const raw =
      "choices" in response ? response.choices?.[0]?.message?.content ?? "" : "";
    const parsed = extractJsonObject(raw);
    if (!parsed?.places || !Array.isArray(parsed.places)) {
      console.warn("ai-shortlist: invalid response", raw);
      continue;
    }

    for (const entry of parsed.places) {
      if (!entry || typeof entry.name !== "string") continue;
      const name = entry.name.trim();
      const searchNameRaw = typeof entry.search_name === "string" ? entry.search_name.trim() : "";
      const searchName = searchNameRaw || name;
      if (!name || !searchName) continue;

      const normalized = normalizeName(searchName) || normalizeName(name);
      if (!normalized || seen.has(normalized)) continue;

      if (AI_BANNED_NAME_RE.test(name) || AI_BANNED_NAME_RE.test(searchName)) continue;

      const category = typeof entry.category === "string" ? entry.category.trim().toLowerCase() : undefined;
      if (category && !AI_ALLOWED_CATEGORIES.has(category)) continue;

      const availabilityRaw = typeof entry.availability === "string" ? entry.availability.trim().toLowerCase() : undefined;
      if (availabilityRaw === "seasonal_future") continue;
      const availability = availabilityRaw === "seasonal_active" ? "seasonal_active" : "year_round";

      const note = typeof entry.note === "string" ? entry.note.trim() : undefined;
      const confidence = Number.isFinite(+entry.confidence) ? Math.max(0, Math.min(1, Number(entry.confidence))) : undefined;
      if (confidence !== undefined && confidence < AI_CONFIDENCE_THRESHOLD) continue;
      const priority = Number.isFinite(+entry.priority) ? Math.round(Number(entry.priority)) : collected.length + 1;

      collected.push({
        name,
        search_name: searchName,
        category,
        note,
        confidence,
        availability,
        priority,
      });
      seen.add(normalized);
      if (collected.length >= maxResults) break;
    }

    const additions = collected.length - beforeCount;
    console.log("ai-shortlist: attempt summary", {
      attempt,
      additions,
      total: collected.length,
    });

    if (additions === 0) {
      console.log("ai-shortlist: no further high-quality additions, stopping early");
      break;
    }
  }

  if (collected.length < minResults) {
    console.warn("ai-shortlist: fewer places than target, prioritising quality", collected.length);
  }

  collected.sort((a, b) => a.priority - b.priority);
  collected.forEach((item, index) => {
    item.priority = index + 1;
  });

  return collected.slice(0, maxResults);
}

type PromptOptions = {
  attempt: number;
  cityName?: string;
  countryName?: string;
  lat: number;
  lng: number;
  tripWindow?: TripWindow;
  remaining: number;
  alreadyProvided: string[];
  maxResults: number;
};

function buildUserPrompt(options: PromptOptions): string {
  const { attempt, cityName, countryName, lat, lng, tripWindow, remaining, alreadyProvided, maxResults } = options;
  const contextLines: string[] = [
    `Latitude: ${lat.toFixed(4)}`,
    `Longitude: ${lng.toFixed(4)}`,
  ];
  if (cityName) contextLines.unshift(`City: ${cityName}`);
  if (countryName) contextLines.push(`Country/Region: ${countryName}`);
  if (tripWindow?.start) contextLines.push(`Trip start: ${tripWindow.start}`);
  if (tripWindow?.end) contextLines.push(`Trip end: ${tripWindow.end}`);

  const templateLines = [
    "{",
    '  "places": [',
    '    { "name": "string", "search_name": "string", "category": "string", "note": "string", "confidence": 0.0, "availability": "year_round", "priority": 1 }',
    "  ]",
    "}",
  ];

  const lines: string[] = [
    "I am a leisure tourist planning a trip.",
    "Context:",
    ...contextLines,
    "",
    `Recommend specific, publicly accessible attractions worth visiting during the trip dates provided.`,
    `Aim to return at least ${remaining} additional unique attractions (maximum ${maxResults}), but stop early if quality would suffer - do not pad the list with mediocre picks.`,
    "For each place output:",
    '- "name": official attraction name (no broad islands/regions unless tied to a flagship venue)',
    '- "search_name": query text for Google Places Text Search (include city/country if needed)',
    '- "category": one of landmark|museum|cultural|heritage|religious|architecture|experience|entertainment|theme_park|adventure|outdoor|nature|park|garden|beach|wildlife|zoo|aquarium|science|history|observation|waterfront|island',
    '- "note": short reason (<120 chars)',
    '- "confidence": number 0-1',
    '- "availability": "year_round", "seasonal_active" (running now), or "seasonal_future" (not yet active)',
    '- "priority": rank starting at 1 (1 = strongest)',
    "",
    "Rules:",
    "- Exclude airports, hospitals, clinics, residential complexes, member-only clubs, bridges used primarily for transport, generic malls, supermarkets, logistics facilities, or stadiums/arenas unless they offer world-famous public tours.",
    "- Skip generic fish/produce/wholesale markets; only include a souk-style venue if it is internationally renowned and offers a curated cultural experience.",
    "- Exclude vague neighbourhoods or islands unless pointing to a single signature attraction that welcomes public visitors.",
    "- Exclude generic business hotels; only include iconic properties with public exhibitions, tours, or signature experiences.",
    "- Prefer iconic landmarks, museums, cultural experiences, renowned parks/gardens, immersive attractions, wildlife or nature reserves with visitor access.",
    "- Stay within roughly 45 km (approximately 45 minutes drive) of the city centre; only include longer day trips when they are globally iconic and operate year-round for tourists.",
    "- Include standout waterfront promenades such as Mamsha Al Saadiyat when applicable, and emphasise the public experiences offered (cycling, dining, art, beach access).",
    "- When recommending multi-purpose leisure districts or islands (e.g., Hudayriat Island), mention the headline public experiences (cycle tracks, beach clubs, food halls, etc.) in the note so travellers understand why it is worth visiting.",
    "- Seasonal venues must only be returned when they are operating within the trip window; otherwise mark them seasonal_future and they will be excluded.",
    "- Respond with JSON exactly in this format:",
    ...templateLines,
    "- Do NOT include extra commentary, markdown, or fields.",
  ];

  if (attempt > 1 && alreadyProvided.length) {
    lines.push(
      "",
      "Places already provided:",
      ...alreadyProvided.map((name, index) => `${index + 1}. ${name}`),
      "",
      `Provide at least ${remaining} additional unique attractions not in the list above.`,
      "Avoid duplicates. Only add new attractions if they are genuinely worth a tourist's limited time; it's acceptable to stop below the target count when options are exhausted."
    );
  }

  return lines.join("\n");
}
