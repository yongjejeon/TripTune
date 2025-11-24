// lib/google.ts
import axios from "axios";
import {
  AI_BANNED_NAME_RE,
  AI_CONFIDENCE_THRESHOLD,
  AISuggestion,
  fetchAISuggestions,
} from "./aiShortlist";
import { INDOOR_KEYWORDS, OUTDOOR_KEYWORDS } from "./constants";
import {
  getDetails as getDetailsCache,
  setDetails as setDetailsCache
} from "./localCache";
import { getUserPreferences } from "./preferences";

export type FetchProgressUpdate = {
  stage: string;
  message: string;
  progress?: number;
};

export type FetchPlacesOptions = {
  cityName?: string;
  countryName?: string;
  tripWindow?: { start?: string; end?: string };
  onProgress?: (update: FetchProgressUpdate) => void;
};

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;

// ====== Helpers: details & opening hours ======
const PLACE_DETAILS_FIELDS = [
  "opening_hours",
  "current_opening_hours",
  "secondary_opening_hours",
  "utc_offset",
  "business_status",
  "formatted_address",
].join(",");

async function fetchPlaceDetailsLocal(placeId: string, i?: number) {
  try {
    const res = await axios.get(
      "https://maps.googleapis.com/maps/api/place/details/json",
      {
        params: {
          place_id: placeId,
          key: API_KEY,
          fields: PLACE_DETAILS_FIELDS,
        },
      }
    );
    const { status, error_message } = res.data || {};
    if (status !== "OK") {
      if ((i ?? 0) < 5) {
        console.warn("details:request status", { i, placeId, status, error_message });
      }
      return null;
    }
    return res.data.result ?? null;
  } catch (e: any) {
    if ((i ?? 0) < 5) {
      console.warn("details:request error", { i, placeId, message: e?.message });
    }
    return null;
  }
}

function getPlaceLocalNow(utcOffsetMinutes?: number): Date {
  const nowUtc = Date.now();
  const offsetMs = (utcOffsetMinutes ?? 0) * 60 * 1000;
  return new Date(nowUtc + offsetMs);
}
function pad2(n: number) {
  return n.toString().padStart(2, "0");
}
function fmtHHMM(hhmm: string) {
  if (!hhmm || hhmm.length < 3) return "";
  const h = hhmm.slice(0, -2);
  const m = hhmm.slice(-2);
  return `${pad2(parseInt(h, 10))}:${m}`;
}

const NAME_NORMALIZE_RE = /[^a-z0-9]+/gi;

const aiShortlistCache = new Map<string, { suggestions: AISuggestion[]; ts: number }>();
const AI_SHORTLIST_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const AI_CATEGORY_TAGS: Record<string, string> = {
  landmark: "iconic",
  museum: "culture",
  cultural: "culture",
  heritage: "heritage",
  religious: "spiritual",
  architecture: "architecture",
  experience: "experience",
  entertainment: "entertainment",
  theme_park: "family",
  adventure: "adventure",
  outdoor: "outdoor",
  nature: "outdoor",
  park: "outdoor",
  garden: "outdoor",
  beach: "relax",
  waterfront: "leisure",
  island: "leisure",
  wildlife: "wildlife",
  zoo: "wildlife",
  aquarium: "wildlife",
  science: "learning",
  history: "heritage",
  observation: "viewpoint",
};

const AI_CATEGORY_DEFAULT_NOTES: Record<string, string> = {
  landmark: "Signature city landmark",
  museum: "World-class museum experience",
  cultural: "Cultural arts and heritage space",
  heritage: "Historic site showcasing local heritage",
  religious: "Architectural religious landmark",
  architecture: "Architectural icon with public access",
  experience: "Immersive visitor experience",
  entertainment: "Entertainment hub with visitor activities",
  theme_park: "Family-friendly theme park",
  adventure: "Adventure activities available",
  outdoor: "Outdoor recreation area",
  nature: "Nature experience with public trails",
  park: "City park perfect for strolls",
  garden: "Scenic gardens to explore",
  beach: "Public beach for relaxation",
  waterfront: "Waterfront promenade with dining",
  island: "Island leisure district accessible to visitors",
  wildlife: "Wildlife encounters available",
  zoo: "Zoo with diverse animal exhibits",
  aquarium: "Aquarium with marine life",
  science: "Interactive science attraction",
  history: "Historic venue for learning",
  observation: "Observation point with panoramic views",
};

const AI_GOOGLE_TYPE_BLOCKLIST = new Set([
  "shopping_mall",
  "department_store",
  "clothing_store",
  "shoe_store",
  "bridge",
  "transit_station",
  "bus_station",
  "train_station",
  "subway_station",
  "light_rail_station",
  "grocery_or_supermarket",
  "supermarket",
  "parking",
  "parking_lot",
  "car_dealer",
  "car_rental",
  "gas_station",
  "bank",
  "insurance_agency",
  "real_estate_agency",
  "storage",
  "warehouse",
  "police",
  "city_hall",
  "local_government_office",
  "embassy",
  "fire_station",
  "courthouse",
  "lawyer",
  "accounting",
  "physiotherapist",
  "spa",
  "beauty_salon",
  "hair_care",
  "lodging",
]);

const AI_GOOGLE_TYPE_OVERRIDES = new Set([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "park",
  "point_of_interest",
  "place_of_worship",
  "amusement_park",
  "aquarium",
  "zoo",
  "natural_feature",
  "campground",
]);

const AI_REMOTE_ISLAND_TYPES = new Set(["island", "natural_feature"]);
const AI_REMOTE_KM_LIMIT = 140;
const AI_MAX_DISTANCE_KM = 60; // cap general shortlist entries to ~1 hour drive

type AISuggestionMeta = AISuggestion & { distanceKm?: number };

function normalizeName(name?: string | null) {
  if (!name) return "";
  return name.toLowerCase().replace(NAME_NORMALIZE_RE, "").trim();
}

function getPlaceKey(place: any) {
  if (!place) return "";
  return place.place_id ?? normalizeName(place.name);
}

function resolveContextTag(category?: string | null) {
  if (!category) return undefined;
  return AI_CATEGORY_TAGS[category] ?? category;
}

function resolveDefaultNote(category?: string | null) {
  if (!category) return undefined;
  return AI_CATEGORY_DEFAULT_NOTES[category];
}

function shouldRejectByTypes(types?: string[] | null): boolean {
  if (!types || !types.length) return false;
  const normalized = types.map((t) => t?.toLowerCase?.() ?? t).filter(Boolean) as string[];
  if (!normalized.length) return false;
  const set = new Set(normalized);
  const hasOverride = normalized.some((t) => AI_GOOGLE_TYPE_OVERRIDES.has(t));

  for (const t of set) {
    if (!AI_GOOGLE_TYPE_BLOCKLIST.has(t)) continue;
    if (t === "bridge" || t === "shopping_mall" || t === "department_store" || t === "clothing_store" || t === "shoe_store") {
      return true;
    }
    if (t === "lodging") {
      if (hasOverride) continue;
      return true;
    }
    if (!hasOverride) return true;
  }

  return false;
}

function isRemoteIslandSuggestion(
  suggestion: AISuggestion,
  place: any,
  originLat: number,
  originLng: number
): boolean {
  const placeLat = place?.geometry?.location?.lat;
  const placeLng = place?.geometry?.location?.lng;
  if (typeof placeLat !== "number" || typeof placeLng !== "number") return false;

  const types = (place?.types ?? []).map((t: string) => t?.toLowerCase?.() ?? t) as string[];
  const isIslandType = suggestion.category === "island" || types.some((t) => AI_REMOTE_ISLAND_TYPES.has(t));
  if (!isIslandType) return false;

  const distance = haversineKm(originLat, originLng, placeLat, placeLng);
  if (!Number.isFinite(distance)) return false;

  return distance > AI_REMOTE_KM_LIMIT;
}

function truncate(str: string | null | undefined, max = 160) {
  if (!str) return undefined;
  if (str.length <= max) return str;
  return `${str.slice(0, max - 3)}...`;
}

type Period = { open: { day: number; time: string }; close?: { day: number; time: string } };

function getTodaysPeriods(details: any, placeLocalNow: Date) {
  const co = details?.current_opening_hours;
  const ro = details?.opening_hours;
  const periods: Period[] = co?.periods || ro?.periods || [];
  if (!periods?.length) {
    return { todayText: undefined, todaysSpans: [], nextOpen: undefined, nextClose: undefined };
  }

  const dayIdx = placeLocalNow.getUTCDay(); // Date already shifted by UTC offset
  const todays = periods.filter((p: Period) => p.open?.day === dayIdx);

  const spans = todays.map((p) => ({
    open: fmtHHMM(p.open.time),
    close: p.close ? fmtHHMM(p.close.time) : undefined,
  }));

  const todayText = spans.length
    ? spans.map((s) => (s.close ? `${s.open}-${s.close}` : `${s.open}-late`)).join(", ")
    : "Closed today";

  // Next open/close (absolute minutes since week start)
  const toAbs = (d: number, t: string) =>
    d * 24 * 60 + parseInt(t.slice(0, -2), 10) * 60 + parseInt(t.slice(-2), 10);
  const weekPeriods = periods.map((p) => ({
    openAbs: toAbs(p.open.day, p.open.time),
    closeAbs: p.close ? toAbs(p.close.day, p.close.time) : undefined,
  }));

  const minsNowAbs =
    placeLocalNow.getUTCDay() * 24 * 60 +
    placeLocalNow.getUTCHours() * 60 +
    placeLocalNow.getUTCMinutes();

  let nextOpenAbs: number | undefined;
  let nextCloseAbs: number | undefined;

  for (const w of weekPeriods) {
    if (w.openAbs > minsNowAbs) {
      if (nextOpenAbs === undefined || w.openAbs < nextOpenAbs) nextOpenAbs = w.openAbs;
    }
    if (w.closeAbs && w.closeAbs > minsNowAbs) {
      if (nextCloseAbs === undefined || w.closeAbs < nextCloseAbs) nextCloseAbs = w.closeAbs;
    }
  }

  function absToISO(absMins: number | undefined, utcOffsetMinutes?: number) {
    if (absMins === undefined) return undefined;
    const day = Math.floor(absMins / (24 * 60));
    const mins = absMins % (24 * 60);
    const hours = Math.floor(mins / 60),
      minutes = mins % 60;

    const now = getPlaceLocalNow(utcOffsetMinutes);
    const sunday = new Date(now);
    sunday.setUTCDate(now.getUTCDate() - now.getUTCDay());
    sunday.setUTCHours(0, 0, 0, 0);

    const target = new Date(sunday);
    target.setUTCDate(sunday.getUTCDate() + day);
    target.setUTCHours(hours, minutes, 0, 0);
    return target.toISOString();
  }

  const nextOpen = absToISO(
    nextOpenAbs,
    details?.utc_offset_minutes ?? details?.utc_offset
  );
  const nextClose = absToISO(
    nextCloseAbs,
    details?.utc_offset_minutes ?? details?.utc_offset
  );

  return { todayText, todaysSpans: spans, nextOpen, nextClose };
}

function getOpenState(details: any) {
  const openNow = Boolean(
    details?.current_opening_hours?.open_now ?? details?.opening_hours?.open_now
  );
  const utcOffsetMinutes = details?.utc_offset_minutes ?? details?.utc_offset;
  const placeNow = getPlaceLocalNow(utcOffsetMinutes);

  const { todayText, nextOpen, nextClose } = getTodaysPeriods(details, placeNow);

  let closingSoon = false;
  if (openNow && nextClose) {
    const msLeft = new Date(nextClose).getTime() - placeNow.getTime();
    closingSoon = msLeft > 0 && msLeft <= 45 * 60 * 1000;
  }

  return {
    openNow,
    closingSoon,
    todaysHoursText: todayText,
    willOpenAt: nextOpen,
    willCloseAt: nextClose,
    utcOffsetMinutes,
  };
}

type BusyLevel = "low" | "medium" | "high";
function estimateBusyLevel(normalizedCategory?: string, utcOffsetMinutes?: number): BusyLevel {
  const now = getPlaceLocalNow(utcOffsetMinutes);
  const h = now.getUTCHours();
  const dow = now.getUTCDay(); // 0 Sun .. 6 Sat
  const weekend = dow === 5 || dow === 6; // Fri/Sat busier in GCC

  switch (normalizedCategory) {
    case "museum":
    case "art_gallery":
      return h >= 11 && h <= 16 ? (weekend ? "high" : "medium") : "low";
    case "beach":
    case "park":
      if (h >= 16 && h <= 19) return "high";
      if (h >= 10 && h <= 15) return weekend ? "high" : "medium";
      return "low";
    case "religious_sites":
      if (dow === 5 && h >= 11 && h <= 14) return "high";
      return "medium";
    case "amusement_park":
      return weekend ? "high" : h >= 13 && h <= 18 ? "medium" : "low";
    default:
      return weekend ? "medium" : "low";
  }
}

// ====== Category defaults (durations) ======
const DEFAULT_TYPE_DURATION: Record<string, number> = {
  museum: 120,
  art_gallery: 90,
  place_of_worship: 75,
  palace: 90,
  fort: 90,
  landmark: 90,
  tourist_attraction: 90,
  park: 120,
  beach: 150,
  aquarium: 120,
  zoo: 150,
  amusement_park: 210,
  stadium: 90,
  market: 75,
  souk: 75,
};

// ====== Allowlist / Blocklist ======
const ALLOW_TYPES = new Set<string>([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "place_of_worship",
  "palace",
  "fort",
  "landmark",
  "park",
  "beach",
  "aquarium",
  "zoo",
  "amusement_park",
  "stadium",
  "market",
  "point_of_interest",
]);

const BLOCK_TYPES = new Set<string>([
  "lodging",
  "hotel",
  "resort",
  "university",
  "school",
  "hospital",
  "pharmacy",
  "doctor",
  "dentist",
  "bank",
  "atm",
  "insurance_agency",
  "embassy",
  "city_hall",
  "local_government_office",
  "police",
  "courthouse",
  "car_rental",
  "car_dealer",
  "gas_station",
  "parking",
  "supermarket",
  "grocery_or_supermarket",
  "convenience_store",
  "real_estate_agency",
  "storage",
  "hardware_store",
  "electrician",
  "travel_agency",
]);

const NAME_BLOCK_RE =
  /(hotel|resort|villas|residence|residential|residences|mall|clinic|bank|car\s*rental|leasing|apartments?|compound)/i;

const NAME_LANDMARK_RE =
  /(mosque|palace|qasr|qasar|fort|citadel|heritage|louvre|museum|observation|corniche|national)/i;

function normalizeCategory(types: string[], name: string): string {
  const t = new Set(types);
  if (t.has("museum")) return "museum";
  if (t.has("art_gallery")) return "art_gallery";
  if (t.has("place_of_worship")) return "religious_sites";
  if (t.has("aquarium")) return "aquarium";
  if (t.has("zoo")) return "zoo";
  if (t.has("amusement_park")) return "amusement_park";
  if (t.has("stadium")) return "sports";
  if (t.has("park")) return "park";
  if (t.has("beach")) return "beach";
  if (t.has("market") || /souk|bazaar/i.test(name)) return "market";
  if (t.has("palace") || /palace|qasr|qasar/i.test(name)) return "landmark";
  if (t.has("fort") || /fort|citadel/i.test(name)) return "landmark";

  if (t.has("tourist_attraction")) {
    if (NAME_LANDMARK_RE.test(name)) return "landmark";
    return "tourist_attraction";
  }
  if (t.has("point_of_interest")) {
    if (NAME_LANDMARK_RE.test(name)) return "landmark";
    return "tourist_attraction";
  }
  return "attraction";
}

function isItineraryAttraction(place: any): boolean {
  const types: string[] = place.types ?? [];
  const name: string = place.name ?? "";

  if (!(place.rating && place.user_ratings_total)) return false;

  if (types.some((t) => BLOCK_TYPES.has(t))) return false;

  if (NAME_BLOCK_RE.test(name)) {
    const strong =
      types.some((t) =>
        [
          "museum",
          "art_gallery",
          "place_of_worship",
          "palace",
          "fort",
          "park",
          "beach",
          "aquarium",
          "zoo",
          "amusement_park",
          "stadium",
        ].includes(t)
      ) || NAME_LANDMARK_RE.test(name);
    if (!strong) return false;
  }

  if (/mall/i.test(name)) {
    const t = new Set(types ?? []);
    const strong = [
      "museum",
      "art_gallery",
      "place_of_worship",
      "palace",
      "fort",
      "park",
      "beach",
      "aquarium",
      "zoo",
      "amusement_park",
      "stadium",
    ];
    if (!strong.some((s) => t.has(s))) return false;
  }

  const hasAllow = types.some((t) => ALLOW_TYPES.has(t));
  if (!hasAllow) return false;

  if (types.length === 1 && types[0] === "point_of_interest") return false;

  if (types.includes("shopping_mall") && !/souk|market/i.test(name)) {
    return false;
  }

  return true;
}

// ====== Fetch nearby by type ======
async function fetchPlacesByType(
  lat: number,
  lng: number,
  type: string,
  radius = 12000,
  limit = 30
) {
  const res = await axios.get(
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
    {
      params: {
        location: `${lat},${lng}`,
        radius,
        type,
        key: API_KEY,
      },
    }
  );
  return (res.data?.results ?? []).slice(0, limit);
}

async function fetchPlaceByText(
  query: string,
  lat?: number,
  lng?: number,
  radius = 25000
) {
  if (!query) return null;
  const params: Record<string, any> = {
    query,
    key: API_KEY,
    language: "en",
  };
  if (lat != null && lng != null) {
    params.location = `${lat},${lng}`;
    params.radius = radius;
  }

  try {
    const res = await axios.get(
      "https://maps.googleapis.com/maps/api/place/textsearch/json",
      { params }
    );
    const results = res.data?.results ?? [];
    if (!results.length) return null;
    return results[0];
  } catch (error: any) {
    console.warn("textsearch:error", { query, message: error?.message ?? error });
    return null;
  }
}

// ====== Scoring helpers ======
function bayesianRating(R = 0, v = 0, mu = 4.2, m = 200) {
  const vv = Math.max(0, v | 0);
  const RR = Math.max(0, Math.min(5, R || 0));
  return (vv / (vv + m)) * RR + (m / (vv + m)) * mu; // 0..5
}
function proximityBoostKm(dKm: number) {
  return 1 / (1 + 0.03 * Math.max(0, dKm));
}
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371,
    toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1),
    dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ====== Photos ======
function buildPhotoUrl(photoRef: string, maxWidth = 800) {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photoreference=${encodeURIComponent(
    photoRef
  )}&key=${API_KEY}`;
}
function parseAttribution(html?: string): { text: string; href?: string } | null {
  if (!html) return null;
  const m = html.match(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/i);
  if (m) return { href: m[1], text: m[2] };
  return { text: html.replace(/<[^>]+>/g, "") };
}

const DEBUG_LISTGEN = true;

// ====== MAIN ENTRY ======
export const fetchPlacesByCoordinates = async (
  lat: number,
  lng: number,
  opts: FetchPlacesOptions = {}
) => {
  const REQ = Math.floor(Math.random() * 1e6);
  const tag = (s: string) => `[fpc#${REQ}] ${s}`;
  console.log(tag("start"), { lat, lng });
  console.time(tag("total"));

  const prefs = (await getUserPreferences()) || null;

  const emitProgress = (stage: string, message: string, progress?: number) => {
    if (opts.onProgress) {
      opts.onProgress({ stage, message, progress });
    }
  };

  emitProgress("start", "Preparing nearby places", 0.05);
  const totalStartTime = Date.now();

  const DETAILS_TTL_DAYS = 21;
  
  // REMOVED: Seed fetch - no longer needed. We rely entirely on AI-curated suggestions matched via text search.
  // This saves ~60 seconds and 13 unnecessary API calls.
  let baseItems: any[] = [];
  
  emitProgress("seed-skipped", "Skipping seed fetch, using AI suggestions only", 0.05);

  // Start AI shortlist generation immediately (no seed fetch blocking it)
  const shortlistMeta = new Map<string, AISuggestionMeta>();
  let shortlistOrder: Map<string, number> | null = null;

  console.log("ai-shortlist: request params", {
    city: opts?.cityName,
    country: opts?.countryName,
    tripWindow: opts?.tripWindow,
  });

  const shortlistKey = [
    lat.toFixed(3),
    lng.toFixed(3),
    (opts?.cityName ?? "").toLowerCase(),
    opts?.tripWindow?.start ?? "",
    opts?.tripWindow?.end ?? "",
  ].join("|");

  const allowCache = true; // AI shortlist caching (seed cache is no longer used)
  let aiShortlist: AISuggestion[] = [];
  
  // Start AI shortlist generation immediately (doesn't need to wait for seed fetch)
  const aiShortlistPromise = (async () => {
    if (allowCache && aiShortlistCache.has(shortlistKey)) {
      const cached = aiShortlistCache.get(shortlistKey);
      const fresh = !!cached && Date.now() - cached.ts < AI_SHORTLIST_CACHE_TTL_MS;
      if (fresh) {
        console.log("ai-shortlist: using cached suggestions", { shortlistKey });
        emitProgress("ai-cache", "Using cached AI shortlist", 0.45);
        return cached ? cached.suggestions.map((s) => ({ ...s })) : [];
      } else {
        aiShortlistCache.delete(shortlistKey);
      }
    }
    
    emitProgress("ai-request", "Asking AI for top sights", 0.45);
    const phase2Start = Date.now();
    // OPTIMIZED: Reduced targets for faster, more accurate results
    const result = await fetchAISuggestions({
      cityName: opts?.cityName,
      countryName: opts?.countryName,
      lat,
      lng,
      tripWindow: opts?.tripWindow,
      // Use default minResults (30) and maxResults (30) from aiShortlist.ts
    });
    const phase2Duration = Date.now() - phase2Start;
    console.log(tag(`⏱️ PHASE 2: AI Shortlist Generation: ${(phase2Duration / 1000).toFixed(2)}s`));

    if (allowCache && result.length) {
      aiShortlistCache.set(shortlistKey, {
        suggestions: result.map((s) => ({ ...s })),
        ts: Date.now(),
      });
    }
    emitProgress("ai-response", "Processing AI shortlist", 0.55);
    return result;
        })();
  
  // Wait for AI shortlist to complete
  aiShortlist = await aiShortlistPromise;

  if (aiShortlist.length === 0) {
    console.warn("ai-shortlist: no suggestions returned");
    emitProgress("ai-empty", "No AI suggestions - using fallback", 0.62);
  } else {
    if (aiShortlist.length < 30) {
      console.warn("ai-shortlist: fewer AI places than target", aiShortlist.length);
    }
    console.log(
      "ai-shortlist: received suggestions",
      aiShortlist.map((s) => ({
        name: s.name,
        category: s.category,
        availability: s.availability,
        priority: s.priority,
        confidence: s.confidence,
      }))
    );
    emitProgress("ai-process", `Matching ${aiShortlist.length} AI suggestions`, 0.7);
  }

  if (aiShortlist.length) {
    const existingById = new Map<string, any>();
    baseItems.forEach((item) => {
      if (item?.place_id) existingById.set(item.place_id, item);
    });

    const seenSuggestionNames = new Set<string>();
    const totalSuggestions = aiShortlist.length || 1;
    
    // Pre-filter suggestions before text search (fast rejection)
    const validSuggestions = aiShortlist.filter((suggestion) => {
      const normalizedSuggestionName = normalizeName(suggestion.name);
      if (normalizedSuggestionName && seenSuggestionNames.has(normalizedSuggestionName)) {
        console.log("ai-shortlist: skip duplicate suggestion name", suggestion.name);
        return false;
      }

      if (
        suggestion.confidence !== undefined &&
        suggestion.confidence < AI_CONFIDENCE_THRESHOLD
      ) {
        console.warn("ai-shortlist: rejected for low confidence", {
          name: suggestion.name,
          confidence: suggestion.confidence,
        });
        return false;
      }

      if (normalizedSuggestionName) seenSuggestionNames.add(normalizedSuggestionName);

      if (AI_BANNED_NAME_RE.test(suggestion.name)) {
        console.warn("ai-shortlist: rejected by banned-name pattern", suggestion.name);
        return false;
      }
      if (suggestion.availability === "seasonal_future") {
        console.warn("ai-shortlist: rejected seasonal_future entry", suggestion.name);
        return false;
      }

      return true;
    });

    console.log(`ai-shortlist: processing ${validSuggestions.length} valid suggestions (batched)`);

    // OPTIMIZATION: Batch text searches in parallel instead of sequential
    const BATCH_SIZE = 5; // Process 5 text searches at a time
    let processedSuggestions = 0;
    
    const phase3Start = Date.now();

    for (let i = 0; i < validSuggestions.length; i += BATCH_SIZE) {
      const batch = validSuggestions.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (suggestion) => {
          console.log("ai-shortlist: resolving via text search", suggestion.search_name);
          const textResult = await fetchPlaceByText(suggestion.search_name, lat, lng);
          return { suggestion, textResult };
        })
      );

      // Process batch results
      for (const { suggestion, textResult } of batchResults) {
        if (!textResult) {
          console.warn("ai-shortlist: unresolved by Google Text Search", suggestion.name);
          continue;
        }

        const key = getPlaceKey(textResult);
        if (!key) {
          console.warn("ai-shortlist: missing key after lookup", suggestion.name);
          continue;
        }

        let distanceKm: number | undefined;
        const placeLat = textResult?.geometry?.location?.lat;
        const placeLng = textResult?.geometry?.location?.lng;
        if (typeof placeLat === "number" && typeof placeLng === "number") {
          distanceKm = haversineKm(lat, lng, placeLat, placeLng);
          if (Number.isFinite(distanceKm) && distanceKm > AI_MAX_DISTANCE_KM) {
            console.warn("ai-shortlist: rejected for distance", {
              name: textResult.name,
              distanceKm: distanceKm.toFixed(1),
            });
            continue;
          }
        }

        const placeTypes = (textResult.types ?? []).map((t: string) => t?.toLowerCase?.() ?? t) as string[];
        if (shouldRejectByTypes(placeTypes)) {
          console.warn("ai-shortlist: rejected by google type", {
            name: textResult.name,
            types: placeTypes,
          });
          continue;
        }

        if (isRemoteIslandSuggestion(suggestion, textResult, lat, lng)) {
          console.warn("ai-shortlist: rejected remote island", {
            name: textResult.name,
            category: suggestion.category,
          });
          continue;
        }

        shortlistMeta.set(key, { ...suggestion, distanceKm });
        if (textResult.place_id && existingById.has(textResult.place_id)) {
          console.log("ai-shortlist: mapped to existing place", textResult.name, {
            priority: suggestion.priority,
          });
          processedSuggestions += 1;
          if (processedSuggestions === totalSuggestions || processedSuggestions % 5 === 0) {
            const progressValue = 0.7 + Math.min(0.15, (processedSuggestions / totalSuggestions) * 0.15);
            emitProgress(
              "ai-map",
              `Matching AI picks (${processedSuggestions}/${totalSuggestions})`,
              progressValue
            );
          }
          continue;
        }

        baseItems.push(textResult);
        if (textResult.place_id) existingById.set(textResult.place_id, textResult);
        console.log("ai-shortlist: added new place from text search", textResult.name, {
          priority: suggestion.priority,
        });
        processedSuggestions += 1;
        if (processedSuggestions === totalSuggestions || processedSuggestions % 5 === 0) {
          const progressValue = 0.7 + Math.min(0.15, (processedSuggestions / totalSuggestions) * 0.15);
          emitProgress(
            "ai-map",
            `Matching AI picks (${processedSuggestions}/${totalSuggestions})`,
            progressValue
          );
        }
      }
    }
    
    const phase3Duration = Date.now() - phase3Start;
    console.log(tag(`⏱️ PHASE 3: Match AI to Google Places (batched): ${(phase3Duration / 1000).toFixed(2)}s`));

    if (shortlistMeta.size) {
      shortlistOrder = new Map(
        [...shortlistMeta.entries()]
          .sort((a, b) => a[1].priority - b[1].priority)
          .map(([key, info]) => [key, info.priority])
      );
      console.log("ai-shortlist: shortlist order", [...shortlistOrder.entries()]);
    }
  }

  emitProgress("details-start", "Fetching detailed info", 0.82);
  const phase4Start = Date.now();

  // 3) Details (use cache, then fill)
  const TOP_FOR_DETAILS = Math.min(60, baseItems.length);
  const head = baseItems
    .slice()
    .sort(
      (a, b) =>
        (b.rating ?? 0) * (b.user_ratings_total ?? 0) -
        (a.rating ?? 0) * (a.user_ratings_total ?? 0)
    )
    .slice(0, TOP_FOR_DETAILS);

  const detailed: { base: any; details: any | null }[] = [];
  const toFetch: any[] = [];

  for (const base of head) {
    const cached = await getDetailsCache(base.place_id);
    const fresh = cached && Date.now() - cached.ts < DETAILS_TTL_DAYS * 86400000;
    if (fresh) {
      detailed.push({ base, details: cached.details });
    } else {
      detailed.push({ base, details: null });
      toFetch.push(base);
    }
  }

  emitProgress("details-fetch", `Fetching details for ${toFetch.length} places`, 0.88);

  const pool = 3;
  for (let i = 0; i < toFetch.length; i += pool) {
    const slice = toFetch.slice(i, i + pool);
    const results = await Promise.all(
      slice.map((p, j) => fetchPlaceDetailsLocal(p.place_id, i + j))
    );
    for (let j = 0; j < slice.length; j++) {
      const det = results[j] ?? null;
      if (det) await setDetailsCache(slice[j].place_id, det);
      const idx = detailed.findIndex((d) => d.base.place_id === slice[j].place_id);
      if (idx >= 0) detailed[idx].details = det;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  
  const phase4Duration = Date.now() - phase4Start;
  console.log(tag(`⏱️ PHASE 4: Place Details Fetch: ${(phase4Duration / 1000).toFixed(2)}s`));

  const detailsNull = detailed.filter((d) => !d.details).length;
  console.log("details:nullCount", detailsNull, "of", detailed.length);
  const hoursPresent = detailed.filter(
    (d) =>
      d.details?.opening_hours ||
      d.details?.current_opening_hours ||
      d.details?.regularOpeningHours ||
      d.details?.currentOpeningHours
  ).length;
  console.log("details:hoursPresent", hoursPresent, "of", detailed.length);

  // 4) Enrich & score (hours not used in ranking yet)
  const enriched = detailed.map(({ base, details }) => {
    const place = base;
    const types: string[] = place.types ?? [];
    const name: string = place.name ?? "";

    const categoryNorm = normalizeCategory(types, name);

    const isIndoor = types.some((t) => INDOOR_KEYWORDS.includes(t));
    const isOutdoor = types.some((t) => OUTDOOR_KEYWORDS.includes(t));
    let ioCategory: "indoor" | "outdoor" | "both" | "unknown" = "unknown";
    if (isIndoor && isOutdoor) ioCategory = "both";
    else if (isIndoor) ioCategory = "indoor";
    else if (isOutdoor) ioCategory = "outdoor";

    const prefDur =
      (prefs?.preferences && prefs.preferences[categoryNorm]?.duration) ||
      DEFAULT_TYPE_DURATION[categoryNorm] ||
      90;

    // Photos
    const photoRef = place.photos?.[0]?.photo_reference ?? null;
    const photoUrl = photoRef ? buildPhotoUrl(photoRef, 800) : null;
    const photoAttrHtml = place.photos?.[0]?.html_attributions?.[0] ?? null;
    const photoAttribution = parseAttribution(photoAttrHtml);

    // Scoring (no hours influence here)
    const R = place.rating ?? 0;
    const V = place.user_ratings_total ?? 0;
    const bayes = bayesianRating(R, V);
    const volume = Math.log1p(V);
    const iconBonus = /mosque|palace|qasr|fort|louvre|heritage|corniche|observation/i.test(
      name
    )
      ? 1.06
      : 1.0;

    let prox = 1.0;
    if (lat && lng && place.geometry?.location?.lat && place.geometry?.location?.lng) {
      const dKm = haversineKm(
        lat,
        lng,
        place.geometry.location.lat,
        place.geometry.location.lng
      );
      prox = proximityBoostKm(dKm);
    }

    const prefRaw =
      (prefs?.preferences && (prefs.preferences[categoryNorm]?.weight ?? 5)) || 5;
    const interestWeight = prefRaw; // keep field for UI/debug
    const prefW = Math.max(0.05, prefRaw / 10);

    const hoursBoost = 1.0; // reserved for adaptation/itinerary step
    const score = bayes * volume * iconBonus * prox * (1 + 0.8 * prefW) * hoursBoost;

    // Hours snapshot for UI
    const hours = details
      ? getOpenState(details)
      : {
          openNow: undefined,
          closingSoon: false,
          todaysHoursText: undefined,
          willOpenAt: undefined,
          willCloseAt: undefined,
          utcOffsetMinutes: undefined,
        };

    const busyLevel: BusyLevel = estimateBusyLevel(categoryNorm, hours.utcOffsetMinutes);

    return {
      ...place,
      lat: place.geometry?.location?.lat ?? null,
      lng: place.geometry?.location?.lng ?? null,
      category: ioCategory,
      preferredDuration: prefDur,
      interestWeight,
      score,

      normalizedCategory: categoryNorm,
      openNow: hours.openNow,
      closingSoon: hours.closingSoon,
      todaysHoursText: hours.todaysHoursText,
      willOpenAt: hours.willOpenAt,
      willCloseAt: hours.willCloseAt,
      utcOffsetMinutes: hours.utcOffsetMinutes,
      busyLevel,

      photoRefRaw: place.photos?.[0]?.photo_reference ?? null,
      photoRef,
      photoUrl,
      photoAttribution,
      photoAttributionRaw: place.photos?.[0]?.html_attributions ?? [],
    };
  });

  let finalList = enriched.slice();

  if (shortlistOrder && shortlistOrder.size) {
    const selected: any[] = [];
    const remainder: any[] = [];

    for (const place of finalList) {
      const key = getPlaceKey(place);
      if (key && shortlistMeta.has(key)) {
        const meta = shortlistMeta.get(key)!;
        console.log("ai-shortlist: decorating final place", meta.name ?? place.name, {
          priority: meta.priority,
          availability: meta.availability,
          contextTag: resolveContextTag(meta.category ?? undefined),
          distanceKm: meta.distanceKm,
        });
        (place as any).aiCuration = {
          keep: true,
          priority: meta.priority,
          source: "ai-shortlist",
          reason: truncate(meta.note) ?? resolveDefaultNote(meta.category ?? undefined),
          confidence: meta.confidence,
          availability: meta.availability === "seasonal_active" ? "seasonal_active" : "year_round",
          contextTag: resolveContextTag(meta.category ?? undefined),
          distanceKm: meta.distanceKm,
        } as AICurationMeta;
        selected.push(place);
      } else {
        remainder.push(place);
      }
    }

    selected.sort((a, b) => {
      const keyA = getPlaceKey(a);
      const keyB = getPlaceKey(b);
      const priA = keyA ? shortlistOrder!.get(keyA) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      const priB = keyB ? shortlistOrder!.get(keyB) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      if (priA !== priB) return priA - priB;
      return (b.score ?? 0) - (a.score ?? 0);
    });

    remainder.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    finalList = [...selected, ...remainder];
  } else {
    finalList.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  finalList = finalList
    .filter((p) => {
      const key = getPlaceKey(p);
      if (!shortlistOrder || !shortlistOrder.size) return true;
      return key ? shortlistOrder.has(key) : false;
    })
    .filter((p) => !AI_BANNED_NAME_RE.test(p.name ?? ""));

  // No artificial limit - use all places from the AI shortlist
  // shortlistOrder.size should match aiShortlist.length, so no need to limit
  // finalList = finalList.slice(0, shortlistLimit); // REMOVED: Don't artificially limit output

  console.log("ai-shortlist: final list ready", finalList.map((p) => ({
    name: p.name,
    aiPriority: (p as any).aiCuration?.priority ?? null,
    source: (p as any).aiCuration?.source ?? "score",
  })));

  emitProgress("complete", "Shortlist ready", 1);

  if (DEBUG_LISTGEN) {
    console.group("listgen:photos");
    const withPhoto = finalList.filter((p) => !!p.photoUrl).length;
    console.log({ withPhoto, withoutPhoto: finalList.length - withPhoto });
    finalList.slice(0, 3).forEach((p, i) =>
      console.log(`#${i + 1}`, p.name, p.photoUrl, p.photoAttribution?.text)
    );
    console.groupEnd();

    const cnt = finalList.length;
    const openNowCnt = finalList.filter((p) => p.openNow === true).length;
    const closingSoonCnt = finalList.filter((p) => p.closingSoon === true).length;
    const hoursMissing = finalList.filter((p) => p.todaysHoursText == null).length;
    const busyDist = finalList.reduce((acc: any, p: any) => {
      const k = p.busyLevel ?? "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    console.group("listgen:hours");
    console.log({ items: cnt, openNow: openNowCnt, closingSoon: closingSoonCnt, hoursMissing });
    console.table(busyDist);
    console.groupEnd();

    console.group("listgen:preview");
    console.table(
      finalList.slice(0, 10).map((p) => ({
        name: p.name,
        catNorm: p.normalizedCategory,
        inOut: p.category,
        rating: p.rating,
        reviews: p.user_ratings_total,
        openNow: p.openNow,
        hours: p.todaysHoursText,
        busy: p.busyLevel,
        dur: p.preferredDuration,
        score: p.score?.toFixed?.(2),
        aiPriority: (p as any).aiCuration?.priority ?? null,
        aiSource: (p as any).aiCuration?.source ?? null,
      }))
    );
    console.groupEnd();
    const totalDuration = Date.now() - totalStartTime;
    console.log(tag(`⏱️ TOTAL: fetchPlacesByCoordinates: ${(totalDuration / 1000).toFixed(2)}s`));
    console.log(tag("✅ Place discovery complete"), { totalPlaces: finalList.length });
  }

  return finalList;
};

// ====== Compact list for the LLM step (unchanged) ======
export const makeCompactPlacesList = (places: any[]) => {
  return places.slice(0, 20).map((p, idx) => ({
    order: idx + 1,
    name: p.name,
    category: p.category,
    rating: p.rating,
    reviews: p.user_ratings_total,
    preferredDuration: p.preferredDuration,
    lat: p.lat,
    lng: p.lng,
  }));
};

type AICurationMeta = {
  keep: boolean;
  reason?: string;
  confidence?: number;
  highlightTags?: string[];
  priority?: number;
  source?: string;
  availability?: "year_round" | "seasonal_active";
  contextTag?: string;
  distanceKm?: number;
};


