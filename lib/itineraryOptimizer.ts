// lib/itineraryOptimizer.ts
import { buildTravelGraph, optimizeItinerary } from "./routeOptimizer";

// ---- Debug helper -----------------------------------------------------------
const DEBUG_OPT = true;
const dbg = (...args: any[]) => DEBUG_OPT && console.log("[OPT]", ...args);

// ---- Time helpers -----------------------------------------------------------
const timeToMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const minutesToTime = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

// ✅ Convert "1 hr 20 mins", "1.5 hr", "90 min", "2h", "2h15" → minutes
const parseDurationToMinutes = (duration: string | number | undefined) => {
  if (duration == null) return 60;
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return Math.max(1, Math.floor(duration));
  }

  const raw = String(duration).toLowerCase().trim();

  // common fast path: pure number
  if (/^\d+(\.\d+)?$/.test(raw)) {
    return Math.max(1, Math.floor(Number(raw)));
  }

  // handle "2h15", "2h", "1.5h"
  const hcompact = raw.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+))?$/);
  if (hcompact) {
    const h = parseFloat(hcompact[1]);
    const extra = hcompact[2] ? parseInt(hcompact[2], 10) : 0;
    return Math.max(1, Math.floor(h * 60 + extra));
  }

  // handle "1 hr 20 min", "1.5 hr", "90 min"
  const hr = raw.match(/(\d+(?:\.\d+)?)\s*h(?:r|ours?)?/);
  const mn = raw.match(/(\d+)\s*m(?:in(?:ute)?s?)?/);
  let total = 0;
  if (hr) total += Math.round(parseFloat(hr[1]) * 60);
  if (mn) total += parseInt(mn[1], 10);
  if (total > 0) return total;

  // final fallback: grab first number as minutes
  const num = raw.match(/(\d+(?:\.\d+)?)/);
  if (num) return Math.max(1, Math.floor(parseFloat(num[1])));

  return 60;
};

// ---- Meal windows & defaults -----------------------------------------------
const START_AT = "09:00"; // day start
const LUNCH_WINDOW = { start: 12 * 60, end: 14 * 60, defaultAt: 12 * 60 + 30 };  // 12:00–14:00 → default 12:30
const DINNER_WINDOW = { start: 18 * 60, end: 20 * 60, defaultAt: 18 * 60 + 30 }; // 18:00–20:00 → default 18:30

const hasMeal = (list: any[], type: "lunch" | "dinner") =>
  list.some(
    (m) => {
      const category = String(m.category || "").toLowerCase();
      const name = String(m.name || "").toLowerCase();
      return category === "meal" && (
        name.includes(type) || 
        (type === "lunch" && (name.includes("lunch") || name.includes("break"))) ||
        (type === "dinner" && (name.includes("dinner") || name.includes("evening")))
      );
    }
  );

const insertMealBlock = (
  list: any[],
  label: string,
  startMin: number,
  durationMin: number,
  reason: string
) => {
  const start_time = minutesToTime(startMin);
  const end_time = minutesToTime(startMin + durationMin);
  list.push({
    order: list.length + 1,
    name: label,
    category: "meal",
    start_time,
    end_time,
    estimated_duration: durationMin,
    reason,
  });
  dbg(`${label.toLowerCase()}:inserted`, { start_time, end_time });
};

// ---- Main entry -------------------------------------------------------------
export const reconstructItinerary = async (
  userCoords: { lat: number; lng: number },
  rawItinerary: any[]
) => {
  try {
    console.log("🔄 Reconstructing itinerary...");
    dbg("raw input count", rawItinerary?.length);

    if (!rawItinerary || rawItinerary.length === 0) {
      console.warn("⚠️ Empty itinerary provided, returning empty result");
      return [];
    }

    // Normalize categories (AI can be inconsistent)
    const normalized = (rawItinerary || []).map((i: any) => ({
      ...i,
      category: String(i.category || "").toLowerCase().trim(),
    }));

    const mealsFromAI = normalized.filter((i) => i.category === "meal");
    const attractions = normalized.filter((i) => i.category !== "meal");
    dbg("split", { mealsFromAI: mealsFromAI.length, attractions: attractions.length });

    if (attractions.length === 0) {
      console.warn("⚠️ No attractions found, returning meals only");
      return mealsFromAI.map((item, idx) => ({
        ...item,
        order: idx + 1,
      }));
    }

    // Build travel graph and optimize visiting order (keeps your existing APIs)
    const { graph } = await buildTravelGraph(userCoords, attractions);
    dbg("graph built nodes", graph?.nodes?.length ?? "n/a");

    const startAt = START_AT;
    const optimizedAttractions = optimizeItinerary(userCoords, attractions, graph, startAt);
    dbg("optimized order", optimizedAttractions.map((a: any) => a.name));

  // Now rebuild a timed plan from 09:00, inserting travel & meals where they fit
  const withMeals: any[] = [];
  let currentTime = timeToMinutes(startAt);

  for (let idx = 0; idx < optimizedAttractions.length; idx++) {
    const item = optimizedAttractions[idx];

    // Log incoming raw values
    dbg("step:start", {
      item: item.name,
      rawDuration: item.estimated_duration,
      rawTravelTime: item.travel_time_minutes,
      currentTime,
    });

    // Estimate travel time (if the optimizer didn’t attach it, fall back)
    // If your graph provides an accessor like graph.travelTime(prev, curr) you can use it here.
    const travelTime = Number.isFinite(item.travel_time_minutes)
      ? Math.max(0, Math.floor(item.travel_time_minutes))
      : 10;

    const duration = parseDurationToMinutes(item.estimated_duration);
    dbg("step:parsed", { duration, travelTime, currentTimeBefore: currentTime });

    // Schedule this attraction
    const start_time = minutesToTime(currentTime + travelTime);
    const end_time = minutesToTime(currentTime + travelTime + duration);

    // Advance the timeline
    currentTime += travelTime + duration;

    dbg("step:scheduled", { item: item.name, start_time, end_time, currentTime });

    withMeals.push({
      ...item,
      estimated_duration: duration,
      start_time,
      end_time,
      travel_time_minutes: travelTime,
    });

    // ---- Smart meal insertion during itinerary building ---------------------
    const alreadyHasLunch = hasMeal(withMeals, "lunch");
    const alreadyHasDinner = hasMeal(withMeals, "dinner");
    
    // Insert lunch if we're in lunch window and don't have lunch yet
    if (!alreadyHasLunch && currentTime >= LUNCH_WINDOW.start && currentTime <= LUNCH_WINDOW.end) {
      const lunchStart = Math.max(currentTime, LUNCH_WINDOW.defaultAt);
      insertMealBlock(withMeals, "Lunch", lunchStart, 60, "Window-based insertion.");
      currentTime = lunchStart + 60;
      dbg("lunch break:inserted", { start_time: minutesToTime(lunchStart), end_time: minutesToTime(lunchStart + 60) });
    }
    
    // Insert dinner if we're in dinner window and don't have dinner yet
    if (!alreadyHasDinner && currentTime >= DINNER_WINDOW.start && currentTime <= DINNER_WINDOW.end) {
      const dinnerStart = Math.max(currentTime, DINNER_WINDOW.defaultAt);
      insertMealBlock(withMeals, "Dinner", dinnerStart, 60, "Window-based insertion.");
      currentTime = dinnerStart + 60;
      dbg("dinner break:inserted", { start_time: minutesToTime(dinnerStart), end_time: minutesToTime(dinnerStart + 60) });
    }
  }

  // ---- Smart fail-safes: add appropriate meals based on time -------------
  const hasLunch = hasMeal(withMeals, "lunch");
  const hasDinner = hasMeal(withMeals, "dinner");
  
  // Smart meal insertion based on current time
  if (!hasLunch && !hasDinner) {
    // No meals at all - insert based on time
    if (currentTime <= DINNER_WINDOW.start) {
      // Before 17:30 - insert lunch
      insertMealBlock(withMeals, "Lunch", currentTime, 60, "Added as fail-safe - no meals planned.");
      currentTime += 60;
    } else {
      // After 17:30 - insert dinner
      insertMealBlock(withMeals, "Dinner", currentTime, 60, "Added as fail-safe - no meals planned.");
      currentTime += 60;
    }
  } else if (!hasLunch && currentTime <= DINNER_WINDOW.start) {
    // Missing lunch and it's still lunch time
    insertMealBlock(withMeals, "Lunch", currentTime, 60, "Added as fail-safe - missed lunch window.");
    currentTime += 60;
  } else if (!hasDinner && currentTime > LUNCH_WINDOW.end) {
    // Missing dinner and it's past lunch time
    insertMealBlock(withMeals, "Dinner", currentTime, 60, "Added as fail-safe - missed dinner window.");
    currentTime += 60;
  }

  dbg("post-loop summary", {
    finalCurrentTime: currentTime,
    meals: withMeals.filter((x) => x.category === "meal").map((x) => x.name),
  });

    // Re-number orders cleanly
    const result = withMeals.map((item, idx) => ({
      ...item,
      order: idx + 1,
    }));
    
    console.log("✅ Itinerary reconstruction completed:", result.length, "items");
    return result;
  } catch (error) {
    console.error("❌ Itinerary reconstruction failed:", error);
    // Return a fallback itinerary with basic timing
    const fallback = (rawItinerary || []).map((item, idx) => ({
      ...item,
      order: idx + 1,
      start_time: "09:00",
      end_time: "17:00",
      estimated_duration: 60,
      travel_time_minutes: 0,
      travel_instructions: "Fallback timing",
    }));
    return fallback;
  }
};
