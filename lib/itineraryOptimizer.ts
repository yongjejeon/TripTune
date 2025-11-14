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

// Convert "1 hr 20 mins", "1.5 hr", "90 min", "2h", "2h15" -> minutes
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
const DEFAULT_START_AT = "09:00"; // day start
const TIME_24H_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const LUNCH_WINDOW = { start: 12 * 60, end: 14 * 60, defaultAt: 12 * 60 + 30 };  // 12:00-14:00 -> default 12:30
const DINNER_WINDOW = { start: 18 * 60, end: 20 * 60, defaultAt: 18 * 60 + 30 }; // 18:00-20:00 -> default 18:30

// Helper to add meal suggestions to activity reason/notes
const addMealSuggestion = (item: any, mealType: "lunch" | "dinner", activityStart: number, activityEnd: number) => {
  const mealWindow = mealType === "lunch" ? LUNCH_WINDOW : DINNER_WINDOW;
  const mealTime = minutesToTime(mealWindow.defaultAt);
  
  // Check if activity overlaps with meal window
  const overlapsMealWindow = 
    (activityStart >= mealWindow.start && activityStart <= mealWindow.end) ||
    (activityEnd >= mealWindow.start && activityEnd <= mealWindow.end) ||
    (activityStart < mealWindow.start && activityEnd > mealWindow.end);
  
  if (overlapsMealWindow) {
    const existingReason = item.reason || "";
    const suggestion = `💡 ${mealType === "lunch" ? "Lunch" : "Dinner"} suggestion: Consider dining at ${item.name} around ${mealTime} or at a nearby restaurant during this visit.`;
    
    // Add suggestion to reason if not already present
    if (!existingReason.toLowerCase().includes(mealType)) {
      item.mealSuggestion = suggestion;
      item.reason = existingReason ? `${existingReason}\n\n${suggestion}` : suggestion;
      dbg(`${mealType} suggestion added`, { 
        activity: item.name, 
        activityTime: `${minutesToTime(activityStart)}-${minutesToTime(activityEnd)}`,
        mealWindow: `${minutesToTime(mealWindow.start)}-${minutesToTime(mealWindow.end)}`
      });
    }
  }
};

const resolveStartTime = (value?: string) => {
  if (!value) return DEFAULT_START_AT;
  const trimmed = value.trim();
  return TIME_24H_PATTERN.test(trimmed) ? trimmed : DEFAULT_START_AT;
};

// ---- Main entry -------------------------------------------------------------
export const reconstructItinerary = async (
  userCoords: { lat: number; lng: number },
  rawItinerary: any[],
  options?: { startTime?: string }
) => {
  const startAt = resolveStartTime(options?.startTime);
  try {
    console.log("Reconstructing itinerary...");
    dbg("raw input count", rawItinerary?.length);

    if (!rawItinerary || rawItinerary.length === 0) {
      console.warn("Empty itinerary provided, returning empty result");
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
      console.warn("No attractions found, returning meals only");
      return mealsFromAI.map((item, idx) => ({
        ...item,
        order: idx + 1,
      }));
    }

    // Build travel graph and optimize visiting order (keeps your existing APIs)
    const { graph } = await buildTravelGraph(userCoords, attractions);
    dbg("graph built nodes", graph?.nodes?.length ?? "n/a");

    const optimizedAttractions = optimizeItinerary(userCoords, attractions, graph, startAt);
    dbg("optimized order", optimizedAttractions.map((a: any) => a.name));

    // Helper to parse ISO time to local minutes of day
    const parseTimeToMinutes = (isoString: string | undefined, contextItem?: any): number | null => {
      if (!isoString) return null;
      try {
        const date = new Date(isoString);
        // Extract local time hours and minutes from the ISO string
        // willCloseAt/willOpenAt are in UTC but represent local time
        // We need to parse the time part correctly
        const hours = date.getUTCHours();
        const mins = date.getUTCMinutes();
        const totalMins = hours * 60 + mins;
        // Reject invalid times (00:00 could be midnight or invalid)
        // If it's exactly 00:00, check if it's likely invalid data
        if (totalMins === 0) {
          // Check if this is likely a valid midnight or invalid data
          const now = new Date();
          const dateDiff = Math.abs(date.getTime() - now.getTime());
          // If the date is more than 24 hours away, treat 00:00 as invalid (missing data)
          // Return 23:59 (1439 minutes) as a safe "late closing" time
          if (dateDiff > 24 * 60 * 60 * 1000) {
            dbg("treating 00:00 as missing closing time, using 23:59", { item: contextItem?.name || "unknown" });
            return 23 * 60 + 59; // 23:59 as default late closing
          }
        }
        return totalMins;
      } catch {
        return null;
      }
    };

    // Now rebuild a timed plan from the configured start, with meal suggestions instead of blocks
    const itineraryItems: any[] = [];
    const mealSuggestions = { lunch: false, dinner: false }; // Track if we've suggested meals
    let currentTime = timeToMinutes(startAt);

    for (let idx = 0; idx < optimizedAttractions.length; idx++) {
      const item = optimizedAttractions[idx];

      dbg("step:start", {
        item: item.name,
        rawDuration: item.estimated_duration,
        rawTravelTime: item.travel_time_minutes,
        currentTime,
      });

      const travelTime = Number.isFinite(item.travel_time_minutes)
        ? Math.max(0, Math.floor(item.travel_time_minutes))
        : 10;

      currentTime += travelTime;
      dbg("step:arrival", { item: item.name, afterTravel: currentTime, travelTime });

      // Calculate activity times
      const duration = parseDurationToMinutes(item.estimated_duration);
      let start_time = minutesToTime(currentTime);
      let activityStartMinutes = currentTime;
      let activityEndMinutes = currentTime + duration;
      let end_time = minutesToTime(activityEndMinutes);
      
      // Validate opening time: ensure activity doesn't start before place opens
      if (item.willOpenAt && item.category !== 'meal') {
        const openMinutes = parseTimeToMinutes(item.willOpenAt, item);
        if (openMinutes !== null && activityStartMinutes < openMinutes) {
          // Activity would start before opening - delay to opening time
          const delay = openMinutes - activityStartMinutes;
          activityStartMinutes = openMinutes;
          start_time = minutesToTime(activityStartMinutes);
          activityEndMinutes = activityStartMinutes + duration;
          end_time = minutesToTime(activityEndMinutes);
          currentTime = activityStartMinutes; // Update currentTime for next activity
          dbg("adjusted for opening time", {
            item: item.name,
            originalStart: minutesToTime(currentTime - travelTime),
            openingTime: minutesToTime(openMinutes),
            adjustedStart: start_time,
            delayMinutes: delay
          });
        }
      }
      
      // Add meal suggestions if activity overlaps with meal windows
      addMealSuggestion(item, "lunch", activityStartMinutes, activityEndMinutes);
      addMealSuggestion(item, "dinner", activityStartMinutes, activityEndMinutes);
      
      // Validate closing time: ensure activity can finish before place closes
      if (item.willCloseAt && item.category !== 'meal') {
        const closeMinutes = parseTimeToMinutes(item.willCloseAt, item);
        if (closeMinutes !== null && activityEndMinutes > closeMinutes) {
          // Activity would end after closing
          const availableTime = closeMinutes - activityStartMinutes - 5; // Leave 5 min buffer
          const minimumDuration = Math.max(45, duration * 0.5); // Need at least 45 min or 50% of original duration
          
          if (availableTime >= minimumDuration && activityStartMinutes < closeMinutes - 30) {
            // We have enough time - adjust to fit before closing
            const adjustedDuration = Math.max(minimumDuration, Math.min(availableTime, duration));
            activityEndMinutes = activityStartMinutes + adjustedDuration;
            end_time = minutesToTime(activityEndMinutes);
            dbg("adjusted for closing time", { 
              item: item.name, 
              originalEnd: minutesToTime(activityStartMinutes + duration),
              closingTime: minutesToTime(closeMinutes),
              adjustedEnd: end_time,
              adjustedDuration: adjustedDuration,
              originalDuration: duration,
              minimumRequired: minimumDuration
            });
          } else {
            // Not enough time - skip this activity
            dbg("skipping activity - not enough time before closing", { 
              item: item.name,
              startTime: start_time,
              closingTime: minutesToTime(closeMinutes),
              wouldEndAt: minutesToTime(activityEndMinutes),
              availableMinutes: availableTime,
              minimumRequired: minimumDuration
            });
            continue;
          }
        }
      }

      dbg("step:scheduled", { item: item.name, start_time, end_time, currentTime: activityStartMinutes });

      const finalDuration = activityEndMinutes - activityStartMinutes;
      
      // Ensure coordinates are preserved (needed for map display)
      const hasCoordinates = item.coordinates && typeof item.coordinates.lat === 'number' && typeof item.coordinates.lng === 'number';
      const coordinatesObj = hasCoordinates 
        ? item.coordinates 
        : (item.lat && item.lng ? { lat: item.lat, lng: item.lng } : null);
      
      itineraryItems.push({
        ...item,
        coordinates: coordinatesObj || item.coordinates, // Preserve or create coordinates object
        estimated_duration: finalDuration,
        start_time,
        end_time,
        travel_time_minutes: travelTime,
      });

      // Update currentTime to activity end time for next activity
      currentTime = activityEndMinutes;
      
      // Track meal suggestions
      if (activityStartMinutes >= LUNCH_WINDOW.start && activityEndMinutes <= LUNCH_WINDOW.end + 60) {
        mealSuggestions.lunch = true;
      }
      if (activityStartMinutes >= DINNER_WINDOW.start && activityEndMinutes <= DINNER_WINDOW.end + 60) {
        mealSuggestions.dinner = true;
      }
    }

  dbg("post-loop summary", {
    finalCurrentTime: currentTime,
    mealSuggestions,
    totalActivities: itineraryItems.length,
  });

    // Re-number orders cleanly
    const result = itineraryItems.map((item, idx) => ({
      ...item,
      order: idx + 1,
    }));
    
    console.log("Itinerary reconstruction completed:", result.length, "items");
    return result;
  } catch (error) {
    console.error("Itinerary reconstruction failed:", error);
    // Return a fallback itinerary with basic timing
    const fallback = (rawItinerary || []).map((item, idx) => ({
      ...item,
      order: idx + 1,
      start_time: startAt,
      end_time: "17:00",
      estimated_duration: 60,
      travel_time_minutes: 0,
      travel_instructions: "-",
    }));
    return fallback;
  }
};
