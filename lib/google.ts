// lib/google.ts
import axios from "axios";
import { INDOOR_KEYWORDS, OUTDOOR_KEYWORDS } from "./constants";
import {
  geoKeyFromLatLng,
  getDetails as getDetailsCache,
  getSeed,
  isFresh,
  setDetails as setDetailsCache,
  setSeed,
} from "./localCache";
import { getUserPreferences } from "./preferences";

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;

// ====== Helpers: details & opening hours ======
const PLACE_DETAILS_FIELDS = [
  "opening_hours",
  "current_opening_hours",
  "secondary_opening_hours",
  "utc_offset",
  "utc_offset_minutes",
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
    ? spans.map((s) => (s.close ? `${s.open}–${s.close}` : `${s.open}–late`)).join(", ")
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
  "shopping_mall", // still blocked by default unless name indicates souk/market
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
  opts?: { bypassSeedCache?: boolean }
) => {
  const REQ = Math.floor(Math.random() * 1e6);
  const tag = (s: string) => `[fpc#${REQ}] ${s}`;
  console.log(tag("start"), { lat, lng, bypass: !!opts?.bypassSeedCache });
  console.time(tag("total"));

  const prefs = (await getUserPreferences()) || null;

  const SEED_TYPES = [
    "tourist_attraction",
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
    "market",
  ];

  const SEED_TTL_HOURS = 24;
  const DETAILS_TTL_DAYS = 21;
  const geokey = geoKeyFromLatLng(lat, lng);
  const bypass = !!opts?.bypassSeedCache;

  let baseItems: any[] | null = null;

  // 1) Seed cache (unless bypass)
  if (!bypass) {
    console.time(tag("seed:lookup"));
    const cachedSeed = await getSeed(geokey);
    console.timeEnd(tag("seed:lookup"));
    if (cachedSeed) {
      const fresh = isFresh(cachedSeed.ts, SEED_TTL_HOURS);
      console.log(tag("seed.cache"), {
        items: cachedSeed.items?.length ?? 0,
        ageMin: Math.round((Date.now() - cachedSeed.ts) / 60000),
        fresh,
      });
      if (fresh) {
        baseItems = cachedSeed.items;
        // SWR revalidate
        (async () => {
          try {
            console.time(tag("seed:fetch total"));
            const fetchedArrays = await Promise.all(
              SEED_TYPES.map((t) => {
                const lbl = tag(`seed:type:${t}`);
                console.time(lbl);
                return fetchPlacesByType(lat, lng, t).finally(() => console.timeEnd(lbl));
              })
            );
            console.timeEnd(tag("seed:fetch total"));

            console.time(tag("seed:dedupe+filter"));
            const merged = ([] as any[]).concat(...fetchedArrays);
            const unique = Array.from(new Map(merged.map((p) => [p.place_id, p])).values());
            const filtered = unique.filter(isItineraryAttraction);
            console.timeEnd(tag("seed:dedupe+filter"));
            console.log(tag("seed:counts"), {
              merged: merged.length,
              unique: unique.length,
              kept: filtered.length,
            });

            console.time(tag("seed:save"));
            await setSeed(geokey, filtered);
            console.timeEnd(tag("seed:save"));
          } catch {
            /* ignore background errors */
          }
        })();
      }
    }
  }

  // 2) If bypass OR no fresh cache → fetch now
  if (!baseItems) {
    console.time(tag("seed:fetch NOW"));
    const fetchedArrays = await Promise.all(SEED_TYPES.map((t) => fetchPlacesByType(lat, lng, t)));
    console.timeEnd(tag("seed:fetch NOW"));

    console.time(tag("seed:dedupe+filter NOW"));
    const merged = ([] as any[]).concat(...fetchedArrays);
    const unique = Array.from(new Map(merged.map((p) => [p.place_id, p])).values());
    const filtered = unique.filter(isItineraryAttraction);
    console.timeEnd(tag("seed:dedupe+filter NOW"));

    console.time(tag("seed:save NOW"));
    await setSeed(geokey, filtered);
    console.timeEnd(tag("seed:save NOW"));

    baseItems = filtered;
  }

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

  if (DEBUG_LISTGEN) {
    console.group("listgen:photos");
    const withPhoto = enriched.filter((p) => !!p.photoUrl).length;
    console.log({ withPhoto, withoutPhoto: enriched.length - withPhoto });
    enriched.slice(0, 3).forEach((p, i) =>
      console.log(`#${i + 1}`, p.name, p.photoUrl, p.photoAttribution?.text)
    );
    console.groupEnd();

    const cnt = enriched.length;
    const openNowCnt = enriched.filter((p) => p.openNow === true).length;
    const closingSoonCnt = enriched.filter((p) => p.closingSoon === true).length;
    const hoursMissing = enriched.filter((p) => p.todaysHoursText == null).length;
    const busyDist = enriched.reduce((acc: any, p: any) => {
      const k = p.busyLevel ?? "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    console.group("listgen:hours");
    console.log({ items: cnt, openNow: openNowCnt, closingSoon: closingSoonCnt, hoursMissing });
    console.table(busyDist);
    console.groupEnd();

    console.group("listgen:preview (pre-sort)");
    console.table(
      enriched.slice(0, 10).map((p) => ({
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
      }))
    );
    console.groupEnd();
  }

  const sorted = enriched.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  if (DEBUG_LISTGEN) {
    const top = sorted.slice(0, 12).map((p) => ({
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
    }));
    console.group("listgen:final top12");
    console.table(top);
    console.groupEnd();
    console.timeEnd(tag("total"));
  }

  return sorted.slice(0, 50);
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
