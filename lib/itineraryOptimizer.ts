// lib/itineraryOptimizer.ts
import { buildTravelGraph, optimizeItinerary } from "./routeOptimizer";

const timeToMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const minutesToTime = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

// ✅ Convert "1 hr 20 mins" → 80 minutes
const parseDurationToMinutes = (duration: string | number | undefined) => {
  if (!duration) return 60;

  if (typeof duration === "number") return duration;

  const lower = duration.toLowerCase();
  const hrMatch = lower.match(/(\d+)\s*hr/);
  const minMatch = lower.match(/(\d+)\s*min/);

  let total = 0;
  if (hrMatch) total += parseInt(hrMatch[1], 10) * 60;
  if (minMatch) total += parseInt(minMatch[1], 10);
  if (total === 0) total = parseInt(duration, 10) || 60;

  return total;
};

export const reconstructItinerary = async (
  userCoords: { lat: number; lng: number },
  rawItinerary: any[]
) => {
  console.log("🔄 Reconstructing itinerary...");

  const meals = rawItinerary.filter((i) => i.category === "meal");
  const attractions = rawItinerary.filter((i) => i.category !== "meal");

  console.log(`🍽 Meals count: ${meals.length}`);
  console.log(`🏛 Attractions count: ${attractions.length}`);

  const { graph } = await buildTravelGraph(userCoords, attractions);
  const optimizedAttractions = optimizeItinerary(
    userCoords,
    attractions,
    graph,
    "09:00"
  );

  const withMeals: any[] = [];
  let currentTime = timeToMinutes("09:00");

  for (const item of optimizedAttractions) {
    // parse duration as minutes
    const duration = parseDurationToMinutes(item.estimated_duration);

    // compute travel time (default 10 min if missing)
    const travelTime = item.travel_time_minutes || 10;

    // update start & end times dynamically
    const start_time = minutesToTime(currentTime + travelTime);
    const end_time = minutesToTime(currentTime + travelTime + duration);

    currentTime += travelTime + duration;

    withMeals.push({
      ...item,
      estimated_duration: duration, // in minutes
      start_time,
      end_time,
      travel_time_minutes: travelTime,
    });

    // Insert Lunch at 12:30 if between 12:00–14:00 and not already added
    if (
      currentTime >= 720 &&
      currentTime <= 840 &&
      !withMeals.some((m) => m.category === "meal" && m.name.includes("Lunch"))
    ) {
      withMeals.push({
        order: withMeals.length + 1,
        name: "Lunch Break",
        category: "meal",
        start_time: "12:30",
        end_time: "13:30",
        estimated_duration: 60,
        reason: "Allocated lunch break.",
      });
      currentTime = 13 * 60 + 30; // reset after lunch
    }

    // Insert Dinner at 18:30 if between 18:00–20:00
    if (
      currentTime >= 1080 &&
      currentTime <= 1200 &&
      !withMeals.some((m) => m.category === "meal" && m.name.includes("Dinner"))
    ) {
      withMeals.push({
        order: withMeals.length + 1,
        name: "Dinner Break",
        category: "meal",
        start_time: "18:30",
        end_time: "19:30",
        estimated_duration: 60,
        reason: "Allocated dinner break.",
      });
      currentTime = 19 * 60 + 30;
    }
  }

  return withMeals.map((item, idx) => ({
    ...item,
    order: idx + 1,
  }));
};
