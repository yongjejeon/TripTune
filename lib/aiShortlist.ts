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
  "art center",
  "art_center",
  "memorial",
  "monument",
]);

export const AI_CONFIDENCE_THRESHOLD = 0.6; // Lowered from 0.75 to be less strict

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

// OPTIMIZED: Request all places in one go - no need for multiple attempts
// Increased min to account for distance rejections (~20% rejection rate expected)
// Let GPT generate as many quality attractions as it can - no strict count requirements
const DEFAULT_MIN = 15; // Minimum we'd like, but not strict
const DEFAULT_MAX = 50; // Upper limit - let GPT generate up to 50 if it wants
const MAX_ATTEMPTS = 1; // Single attempt - let GPT decide how many it can generate

// Phase 1: Simple generation with minimal restrictions
async function phase1SimpleGeneration(params: FetchParams): Promise<any[]> {
  const client = getOpenAIClient();
  if (!client) return [];

  const area = params.cityName 
    ? (params.countryName ? `${params.cityName}, ${params.countryName}` : params.cityName)
    : (params.countryName || `location at ${params.lat.toFixed(4)}, ${params.lng.toFixed(4)}`);

  const phase1Prompt = `I am a tourist traveling to ${area}. Generate 30 tourist attractions.

Return a JSON object with this structure:
{
  "places": [
    { "name": "Attraction Name 1", "category": "museum", "note": "Why it's worth visiting" },
    { "name": "Attraction Name 2", "category": "landmark", "note": "Why it's worth visiting" }
    // ... continue with 30 attractions total
  ]
}

Generate exactly 30 quality tourist attractions.`;

  const phase1Start = Date.now();
  console.log("ai-shortlist: Phase 1 - Simple generation starting...");

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a helpful travel assistant. Generate tourist attractions in valid JSON format only.",
        },
        {
          role: "user",
          content: phase1Prompt,
        },
      ],
      temperature: 0.1,
      max_tokens: 8000,
    });

    const phase1Duration = Date.now() - phase1Start;
    console.log(`⏱️ AI Shortlist Phase 1 (Simple Generation): ${(phase1Duration / 1000).toFixed(2)}s`);

    const raw = "choices" in response ? response.choices?.[0]?.message?.content ?? "" : "";
    const parsed = extractJsonObject(raw);
    
    if (!parsed?.places || !Array.isArray(parsed.places)) {
      console.warn("ai-shortlist: Phase 1 invalid response", raw);
      return [];
    }

    console.log(`ai-shortlist: Phase 1 generated ${parsed.places.length} raw places`);
    console.log(`ai-shortlist: Phase 1 places list:`);
    parsed.places.forEach((place: any, index: number) => {
      const name = typeof place.name === "string" ? place.name.trim() : "unknown";
      const category = typeof place.category === "string" ? place.category : "unknown";
      console.log(`  ${index + 1}. ${name} (${category})`);
    });
    return parsed.places;
  } catch (error: any) {
    console.error("ai-shortlist: Phase 1 failed:", error?.message || error);
    return [];
  }
}

// Phase 2: Apply all restrictions and filters from current prompt
async function phase2FilterAndRefine(
  phase1Places: any[],
  params: FetchParams
): Promise<AISuggestion[]> {
  const client = getOpenAIClient();
  if (!client) return [];

  if (phase1Places.length === 0) {
    console.warn("ai-shortlist: Phase 2 skipped - no places from Phase 1");
    return [];
  }

  const maxResults = params.maxResults ?? DEFAULT_MAX;
  const phase2Prompt = buildPhase2Prompt(phase1Places, params);

  const phase2Start = Date.now();
  console.log("ai-shortlist: Phase 2 - Filtering and refining starting...");

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a precise travel assistant. Filter and refine tourist attractions according to strict rules. Reply with valid JSON only.",
        },
        {
          role: "user",
          content: phase2Prompt,
        },
      ],
      temperature: 0.1,
      max_tokens: 8000,
    });

    const phase2Duration = Date.now() - phase2Start;
    console.log(`⏱️ AI Shortlist Phase 2 (Filter & Refine): ${(phase2Duration / 1000).toFixed(2)}s`);

    const raw = "choices" in response ? response.choices?.[0]?.message?.content ?? "" : "";
    const parsed = extractJsonObject(raw);
    
    if (!parsed?.places || !Array.isArray(parsed.places)) {
      console.warn("ai-shortlist: Phase 2 invalid response", raw);
      return [];
    }

    // Track which Phase 1 places were removed by AI filtering and log reasons
    const phase1PlaceNames = new Set(phase1Places.map((p: any) => 
      typeof p.name === "string" ? p.name.trim().toLowerCase() : ""
    ).filter(Boolean));
    
    const phase2PlaceNames = new Set(parsed.places.map((p: any) => 
      typeof p.name === "string" ? p.name.trim().toLowerCase() : ""
    ).filter(Boolean));
    
    // Check if AI provided rejected items with reasons
    const rejectedItems = Array.isArray(parsed.rejected) ? parsed.rejected : [];
    const rejectedMap = new Map<string, string>();
    rejectedItems.forEach((item: any) => {
      if (item && typeof item.name === "string" && typeof item.reason === "string") {
        rejectedMap.set(item.name.trim().toLowerCase(), item.reason.trim());
      }
    });
    
    const aiFilteredOut = Array.from(phase1PlaceNames).filter(name => !phase2PlaceNames.has(name));
    
    if (aiFilteredOut.length > 0) {
      console.log(`ai-shortlist: Phase 2 AI removed ${aiFilteredOut.length} places from Phase 1:`);
      aiFilteredOut.forEach((name, index) => {
        const reason = rejectedMap.get(name.toLowerCase());
        if (reason) {
          console.log(`  ${index + 1}. "${name}" - Reason: ${reason}`);
        } else {
          console.log(`  ${index + 1}. "${name}" - Removed by AI (no reason provided)`);
        }
      });
    } else {
      console.log(`ai-shortlist: Phase 2 AI kept all ${phase1Places.length} places from Phase 1`);
    }

    // Trust Phase 2 AI output completely - only check for duplicates and missing required fields
    const collected: AISuggestion[] = [];
    const seen = new Set<string>();
    const filteredOut: Array<{ name: string; reason: string }> = [];

    console.log(`ai-shortlist: Phase 2 received ${parsed.places.length} places from AI filtering`);
    console.log(`ai-shortlist: Trusting AI output - only removing duplicates and invalid entries`);

    for (const entry of parsed.places) {
      // Only check for missing critical fields
      if (!entry || typeof entry.name !== "string" || !entry.name.trim()) {
        filteredOut.push({ name: entry?.name || "unknown", reason: "Missing or invalid name field" });
        continue;
      }
      
      const name = entry.name.trim();
      const searchNameRaw = typeof entry.search_name === "string" ? entry.search_name.trim() : "";
      const searchName = searchNameRaw || name;
      
      // Check for duplicates only
      const normalized = normalizeName(searchName) || normalizeName(name);
      if (!normalized) {
        // If we can't normalize, still try to use the name as-is
        console.log(`ai-shortlist: Warning - could not normalize "${name}", using as-is`);
      }
      
      if (normalized && seen.has(normalized)) {
        filteredOut.push({ name, reason: "Duplicate (normalized name already seen)" });
        continue;
      }

      // Accept everything else that Phase 2 AI approved - no additional filtering
      const category = typeof entry.category === "string" ? entry.category.trim().toLowerCase() : undefined;
      const availabilityRaw = typeof entry.availability === "string" ? entry.availability.trim().toLowerCase() : undefined;
      const availability = availabilityRaw === "seasonal_active" ? "seasonal_active" : "year_round";
      const note = typeof entry.note === "string" ? entry.note.trim() : undefined;
      const confidence = Number.isFinite(+entry.confidence) ? Math.max(0, Math.min(1, Number(entry.confidence))) : undefined;
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
      
      if (normalized) {
        seen.add(normalized);
      }
      
      if (collected.length >= maxResults) {
        const remaining = parsed.places.length - collected.length - filteredOut.length;
        if (remaining > 0) {
          console.log(`ai-shortlist: Phase 2 reached maxResults (${maxResults}), ${remaining} places not processed`);
        }
        break;
      }
    }

    // Log results
    console.log(`ai-shortlist: Phase 2 final result: ${collected.length} places (from ${parsed.places.length} AI-approved places)`);
    
    if (filteredOut.length > 0) {
      console.log(`ai-shortlist: Removed ${filteredOut.length} entries (duplicates/invalid only):`);
      filteredOut.forEach((item, index) => {
        console.log(`  ${index + 1}. "${item.name}" - ${item.reason}`);
      });
    }
    return collected;
  } catch (error: any) {
    console.error("ai-shortlist: Phase 2 failed:", error?.message || error);
    return [];
  }
}

export async function fetchAISuggestions(params: FetchParams): Promise<AISuggestion[]> {
  const minResults = params.minResults ?? DEFAULT_MIN;
  const maxResults = params.maxResults ?? DEFAULT_MAX;

  // Phase 1: Simple generation - generate as many as possible
  const phase1Places = await phase1SimpleGeneration(params);
  
  if (phase1Places.length === 0) {
    console.warn("ai-shortlist: Phase 1 returned no places");
    return [];
  }

  // Phase 2: Apply all restrictions and filters
  let collected = await phase2FilterAndRefine(phase1Places, params);

  if (collected.length === 0) {
    console.warn("ai-shortlist: Phase 2 filtered out all places");
    return [];
  }

  // Sort by priority and reassign sequential priorities
  collected.sort((a, b) => a.priority - b.priority);
  collected.forEach((item, index) => {
    item.priority = index + 1;
  });

  console.log(`ai-shortlist: Final result - ${collected.length} places (target: ${minResults}-${maxResults})`);

  return collected.slice(0, maxResults);
}

function buildPhase2Prompt(phase1Places: any[], params: FetchParams): string {
  const { cityName, countryName, lat, lng, tripWindow, maxResults } = params;
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
    '  ],',
    '  "rejected": [',
    '    { "name": "string", "reason": "which filtering rule it violated (e.g., "Rule 1: Non-tourist facility", "Rule 2: Outside 45km radius", "Rule 3: Island recommendation") }',
    '  ]',
    "}",
  ];

  // Format Phase 1 places for display
  const phase1List = phase1Places
    .slice(0, 100) // Limit display to first 100 to avoid token limit
    .map((place: any, index: number) => {
      const name = typeof place.name === "string" ? place.name.trim() : `Place ${index + 1}`;
      const category = typeof place.category === "string" ? place.category : "unknown";
      const note = typeof place.note === "string" ? place.note : "";
      return `${index + 1}. ${name} (${category})${note ? ` - ${note}` : ""}`;
    })
    .join("\n");

  const lines: string[] = [
    "Review the following list of tourist attractions. Keep ONLY attractions that meet ALL the filtering requirements below. Be selective but aim to keep at least 20-25 high-quality attractions after filtering.",
    "",
    "Context:",
    ...contextLines,
    "",
    "Raw list of attractions from initial generation:",
    phase1List,
    "",
    `Aim to keep around ${maxResults || 50} high-quality attractions after filtering.`,
    "",
    "For each place that passes the filters, output:",
    '- "name": official attraction name (no broad islands/regions unless tied to a flagship venue)',
    '- "search_name": query text for Google Places Text Search (include city/country if needed)',
    '- "category": one of landmark|museum|cultural|heritage|religious|architecture|experience|entertainment|theme_park|adventure|outdoor|nature|park|garden|beach|wildlife|zoo|aquarium|science|history|observation|waterfront|island',
    '- "note": short reason (<120 chars)',
    '- "confidence": number 0-1 (higher for better quality attractions)',
    '- "availability": "year_round", "seasonal_active" (running now), or "seasonal_future" (not yet active)',
    '- "priority": rank starting at 1 (1 = strongest, most important)',
    "",
    "FILTERING RULES - Exclude any place that violates these:",
    "",
    "1. EXCLUDE these types of places:",
    "   - Airports, hospitals, clinics, residential complexes, member-only clubs, unique experiences",
    "   - Bridges used primarily for transport",
    "   - Generic malls, supermarkets, wholesale markets, logistics facilities",
    "   - Stadiums/arenas unless they offer world-famous public tours",
    "   - Generic fish/produce/meat/seafood/wet markets (unless internationally renowned souk-style venue)",
    "   - Vague neighbourhoods unless pointing to a single signature attraction",
    "   - Generic business hotels (only include iconic properties with public exhibitions/tours)",
    "",
    "2. GEOGRAPHICAL RESTRICTION:",
    "   - CRITICAL: Stay within 45 km (approximately 45 minutes drive) of the city centre",
    "   - Do NOT suggest places in other cities far from the destination",
    "   - Focus exclusively on attractions within the specified city/region",
    "",
    "3. ISLAND RESTRICTION:",
    "   - EXCLUDE all island recommendations ",
    "   - Islands are too vague and not specific tourist attractions",
    "   - Only include islands if they have a specific, named tourist attraction",
    "",
    "Output filtered list in JSON format:",
    ...templateLines,
    "",
    "IMPORTANT:",
    "- Keep places from the provided list that pass the filtering rules in the 'places' array",
    "- List all removed places in the 'rejected' array with the specific reason (which rule number it violated)",
    "- If a place is tagged as 'unique experience' but is actually a hospital, clinic, or medical facility (check the name), EXCLUDE it.",
    "- Be generous: if a place is borderline but has tourist value, KEEP it",
    "- Only exclude places that clearly violate the rules",
    "- Do NOT add new places not in the original list",
    "- Do NOT include extra commentary, markdown, or fields outside the JSON structure",
    "- Sort places by priority (1 = most important/must-see)",
    "- For rejected items, specify the exact rule violated (e.g., 'Rule 1: Non-tourist facility', 'Rule 2: Outside 45km radius', 'Rule 3: Island recommendation')",
    "",
    `Aim to keep ${Math.min(25, maxResults || 25)}-${maxResults || 50} high-quality places after filtering. Quality over quantity, but be generous with borderline cases.`,
  ];

  return lines.join("\n");
}
