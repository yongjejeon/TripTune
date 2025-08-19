// lib/optimizer.ts
import axios from "axios";

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY!;


export const getTravelTime = async (
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
) => {
  try {
    const res = await axios.get(
      "https://maps.googleapis.com/maps/api/directions/json",
      {
        params: {
          origin: `${origin.lat},${origin.lng}`,
          destination: `${destination.lat},${destination.lng}`,
          mode: "transit",
          key: API_KEY,
        },
      }
    );

    if (res.data.status !== "OK") {
      console.warn(`⚠️ Directions API failed: ${res.data.status}`);
      return { duration: Infinity, instructions: "No route found" };
    }

    const leg = res.data.routes[0]?.legs[0];
    if (!leg) {
      console.warn("⚠️ No legs found in directions response");
      return { duration: Infinity, instructions: "No route found" };
    }

    // Build detailed instructions including bus/subway info
    const steps = leg.steps.map((s: any) => {
      if (s.travel_mode === "TRANSIT" && s.transit_details) {
        const td = s.transit_details;
        const line = td.line;
        const vehicle = line.vehicle.type; // BUS, SUBWAY, etc.
        const shortName = line.short_name || line.name;

        return `${vehicle} ${shortName} from ${td.departure_stop.name} ➝ ${td.arrival_stop.name}`;
      } else {
        // walking instructions (strip HTML tags)
        return s.html_instructions.replace(/<[^>]+>/g, "");
      }
    });

    return {
        duration: leg.duration.value, // seconds
        durationText: leg.duration.text, // "21 mins"
        instructions: steps.join(" ➝ "),
    };
  } catch (err) {
    console.error("❌ Error fetching directions:", err);
    return { duration: Infinity, instructions: "API error" };
  }
};


// Build graph for all places (excluding meals)
export const buildTravelGraph = async (
  userCoords: { lat: number; lng: number },
  places: any[]
) => {
  const graph: Record<string, Record<string, { time: number; instructions: string }>> = {};

  const allNodes = [{ name: "UserStart", ...userCoords }, ...places];

  for (let i = 0; i < allNodes.length; i++) {
    graph[allNodes[i].name] = {};
    for (let j = 0; j < allNodes.length; j++) {
      if (i === j) continue;

      const { duration, instructions } = await getTravelTime(allNodes[i], allNodes[j]);
      graph[allNodes[i].name][allNodes[j].name] = {
        time: duration,
        instructions,
      };
    }
  }

  return { graph, nodes: allNodes };
};



// Greedy nearest-neighbor route (approximation of TSP)
export const optimizeItinerary = (
  userCoords: { lat: number; lng: number },
  places: any[],
  graph: Record<string, Record<string, { time: number; instructions: string }>>,
  startTime: string = "09:00"
) => {
  const visited: Set<string> = new Set();
  const path: any[] = [];
  let current = "UserStart";

  const timeToMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const minutesToTime = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  let currentTime = timeToMinutes(startTime);

  while (visited.size < places.length) {
    const next = places
      .filter((p) => !visited.has(p.name))
      .reduce((best, candidate) => {
        const travelData = graph[current][candidate.name];
        if (!travelData) return best;
        if (!best || travelData.time < best.time) {
          return { place: candidate, ...travelData };
        }
        return best;
      }, null as any);

    if (!next) break;

    currentTime += Math.round(next.time / 60); // travel
    const start = minutesToTime(currentTime);

    currentTime += Math.round(next.place.preferredDuration || 60); // visit duration
    const end = minutesToTime(currentTime);

    path.push({
        ...next.place,
        start_time: start,
        end_time: end,
        travel_time_minutes: Math.round(next.time / 60),
        travel_time_text: next.durationText, // new
        travel_instructions: next.instructions,
    });


    visited.add(next.place.name);
    current = next.place.name;
  }

  return path;
};
