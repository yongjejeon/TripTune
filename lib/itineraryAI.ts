// lib/itineraryAI.ts - robust 1-day itinerary generator (uses only your places)
import AsyncStorage from "@react-native-async-storage/async-storage";
import OpenAI from "openai";

// You can keep using your existing OpenAI key env var
const client = new OpenAI({
  apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY!,
});

// Small helper: build a compact, model-friendly list with the fields we actually need.
// (We do this here so you DON'T have to change makeCompactPlacesList right now.)
function buildCompact(places: any[], cap = 28) {
  return (places || [])
    .slice(0, cap) // keep tokens under control
    .map((p: any) => ({
      place_id: p.place_id ?? null,
      name: p.name,
      category: p.normalizedCategory || p.category || "attraction",
      lat: p.lat ?? p.geometry?.location?.lat ?? null,
      lng: p.lng ?? p.geometry?.location?.lng ?? null,
      preferredDuration: p.preferredDuration ?? 90, // minutes
      rating: p.rating ?? null,
      reviews: p.user_ratings_total ?? null,

      // Hours (optional, if you passed them through google.ts)
      openNow: p.openNow ?? null,
      todaysHoursText: p.todaysHoursText ?? null,
      willOpenAt: p.willOpenAt ?? null,
      willCloseAt: p.willCloseAt ?? null,
      utcOffsetMinutes: p.utcOffsetMinutes ?? null,
    }));
}

// Robust JSON extractor (handles ```json fences, leading/trailing text, etc.)
function extractJsonObject(text: string): any | null {
  if (!text) return null;
  // strip code fences if present
  let s = text.replace(/```json|```/g, "").trim();

  // fast path
  try { return JSON.parse(s); } catch {}

  // try to find the first {...} block
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = s.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch {}
  }
  return null;
}

export const generateItinerary = async (
  places: any[],
  userCoords: { lat: number; lng: number },
  opts?: { 
    date?: string;
    availablePlaces?: string[];
    usedPlaces?: string[];
    anchorPlaces?: string[];
  }  
) => {
  // Load user prefs (may include { preferences, mustSee, age, height, weight })
  const stored = await AsyncStorage.getItem("userPreferences");
  const prefs = stored ? JSON.parse(stored) : {};

  // Build a compact list for the model (include place_id + hours + durations)
  const compactList = buildCompact(places);

  // Pull out must-see IDs (if any) so the model can prioritize
  const mustSee: string[] = Array.isArray(prefs?.mustSee) ? prefs.mustSee : [];

  const systemMessage = `
You are a precise, locality-aware itinerary planner.

Hard rules you MUST follow:
- Use ONLY places provided in the user input ("places"). Do NOT invent place names or addresses.
- Prefer the user's must-see items (if present in places); schedule them early when feasible.
- Respect opening hours if provided; if unknown, state "unknown" in reason and avoid confident claims.
- Do NOT invent specific bus/metro route numbers. Give mode suggestions and rough minutes only (e.g., "Walk ~8 min", "Taxi ~12 min", "Bus/Metro ~18-25 min"). Do NOT invent route numbers.
- Output VALID JSON ONLY that conforms to the provided schema. No extra prose.

Soft rules:
- Start near the user's coordinates; keep hops compact (ideally <= 25 min each).
- Cluster stops by proximity to reduce backtracking.
- Allocate more time for large museums/parks.
- Add generic Lunch and Dinner time blocks (no venue names; 60-90 min each).
`.trim();

  const userPrompt = `
Plan a **single-day itinerary** using ONLY the places in \`places\`. Do not invent places.

User location (start):
- lat: ${userCoords.lat}
- lng: ${userCoords.lng}

User profile & preferences JSON (may contain "preferences", "mustSee", age/height/weight):
${JSON.stringify(prefs, null, 2)}

Must-see place_ids (hard-prioritize if present in places):
${JSON.stringify(mustSee, null, 2)}

       ${opts?.availablePlaces ? `
       AVAILABLE PLACES FOR THIS DAY (you can ONLY select from these):
       ${JSON.stringify(opts.availablePlaces, null, 2)}
       
       PLACES ALREADY USED IN PREVIOUS DAYS (do NOT select these):
       ${JSON.stringify(opts.usedPlaces || [], null, 2)}
       
       ${opts?.anchorPlaces ? `
       ANCHOR PLACES FOR THIS DAY (MUST be included in your itinerary):
       ${JSON.stringify(opts.anchorPlaces, null, 2)}
       ` : ''}
       ` : ''}

Places (ranked compact list; you may choose any subset of 5-6 stops from these only):
${JSON.stringify(compactList, null, 2)}

       CRITICAL RULES:
       1) You MUST select 5-6 stops from "places" to create a full day itinerary. Do NOT select fewer than 5 places.
       2) Use the EXACT "name" field from the places list - do NOT use place_id as the name.
       3) Match each chosen stop by exact "place_id" when present, else exact "name".
       4) IMPORTANT: Only select places that are in the "places" list above. Do NOT select any place not explicitly listed.
       ${opts?.availablePlaces ? '5) CRITICAL: You can ONLY select places from the "AVAILABLE PLACES FOR THIS DAY" list above. Do NOT select any place from the "PLACES ALREADY USED" list.' : ''}
       ${opts?.anchorPlaces ? '6) MANDATORY: You MUST include ALL places from the "ANCHOR PLACES FOR THIS DAY" list in your itinerary. These are the user\'s selected must-see places for this specific day.' : '6)'}
       7) Create a diverse itinerary with different types of activities (museums, parks, landmarks, etc.).
       8) If hours are present for a place:
          - Prefer times when it's open.
          - If closed all day, skip it unless it's must-see (then schedule a short external photo-stop and explain in reason).
       9) For travel between stops, provide:
          - "travel_time_minutes": integer minutes
          - "travel_instructions": just mode+time (e.g., "Walk ~10 min", "Taxi ~15-20 min", "Bus/Metro ~18-25 min; check Google Maps"). Do NOT invent route numbers.
       10) Do NOT include meal blocks. Instead, add meal suggestions in the "reason" field for activities that overlap with lunch (12:00-14:00) or dinner (18:00-20:00) windows, e.g., "💡 Lunch suggestion: Consider dining at [place name] around 12:30 or at a nearby restaurant during this visit."
       11) Use integer minutes for "estimated_duration".
       12) Start around 09:00 local time and end by early evening unless hours force changes.
       13) IMPORTANT: Create a realistic day itinerary with 3-4 activities (not 5-6). Focus on quality over quantity. Do not create incomplete or overly packed itineraries.

Output JSON ONLY with this schema:

{
  "itinerary": [
    {
      "order": number,                      // 1..N
      "place_id": "string|null",            // from input when present
      "name": "string",                     // EXACT from input
      "category": "string",                 // e.g., museum/park/landmark/meal
      "lat": number,
      "lng": number,
      "start_time": "HH:MM",
      "end_time": "HH:MM",
      "estimated_duration": number,         // minutes
      "travel_time_minutes": number,        // minutes from previous stop (0 for first)
      "travel_instructions": "string",      // e.g., "Walk ~8 min" / "Taxi ~12 min"; no route numbers
      "reason": "string"                    // rationale incl. hours/priority/proximity
    }
  ]
}
`.trim();

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.5,
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices?.[0]?.message?.content || "";
  const parsed = extractJsonObject(raw);

  if (parsed?.itinerary && Array.isArray(parsed.itinerary)) {
    // Final safety pass: coerce numeric fields to integers to match your UI
    parsed.itinerary = parsed.itinerary.map((item: any, i: number) => {
      const int = (v: any) => (Number.isFinite(+v) ? Math.round(+v) : 0);
      return {
        order: Number.isFinite(+item?.order) ? Math.round(+item.order) : i + 1,
        place_id: item?.place_id ?? null,
        name: String(item?.name ?? "Unknown"),
        category: String(item?.category ?? "attraction"),
        lat: Number(item?.lat ?? 0),
        lng: Number(item?.lng ?? 0),
        start_time: String(item?.start_time ?? "09:00"),
        end_time: String(item?.end_time ?? "09:00"),
        estimated_duration: int(item?.estimated_duration ?? 60),
        travel_time_minutes: int(item?.travel_time_minutes ?? (i === 0 ? 0 : 10)),
        travel_instructions: String(item?.travel_instructions ?? (i === 0 ? "Start" : "Walk ~10 min")),
        reason: String(item?.reason ?? ""),
      };
    });
    return parsed;
  }

  // Fallback (keeps app from crashing if model returns bad JSON)
  console.warn("AI returned non-JSON or invalid JSON. Raw:", raw);
  return {
    itinerary: [
      {
        order: 1,
        place_id: null,
        name: "Itinerary generation failed",
        category: "info",
        lat: userCoords.lat,
        lng: userCoords.lng,
        start_time: "09:00",
        end_time: "09:15",
        estimated_duration: 15,
        travel_time_minutes: 0,
        travel_instructions: "-",
        reason: "Model output was not valid JSON; please try again.",
      },
    ],
  };
};

export default generateItinerary;
