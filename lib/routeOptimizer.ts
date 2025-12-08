// lib/optimizer.ts
import axios from "axios";

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY!;


export const getTravelTime = async (
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: "transit" | "driving" = "transit"
) => {
  try {
    const originStr = `${origin.lat},${origin.lng}`;
    const destStr = `${destination.lat},${destination.lng}`;
    
    console.log(`[Route Debug] Requesting route from ${originStr} to ${destStr} (mode: ${mode})`);
    console.log(`[Route Debug] Origin: lat=${origin.lat}, lng=${origin.lng}`);
    console.log(`[Route Debug] Destination: lat=${destination.lat}, lng=${destination.lng}`);
    console.log(`[Route Debug] API Key present: ${!!API_KEY}`);
    
    const res = await axios.get(
      "https://maps.googleapis.com/maps/api/directions/json",
      {
        params: {
          origin: originStr,
          destination: destStr,
          mode: mode,
          key: API_KEY,
        },
      }
    );

    console.log(`[Route Debug] API Response status: ${res.data.status}`);
    console.log(`[Route Debug] API Response has routes: ${!!res.data.routes}`);
    console.log(`[Route Debug] API Response routes count: ${res.data.routes?.length || 0}`);
    
    if (res.data.status !== "OK") {
      console.warn(`[Route Debug] Directions API failed: ${res.data.status}`);
      if (res.data.error_message) {
        console.warn(`[Route Debug] Error message: ${res.data.error_message}`);
      }
      // Try falling back to driving mode if transit fails
      if (mode === "transit" && res.data.status !== "OK") {
        console.log(`[Route Debug] Transit failed, trying driving mode...`);
        const drivingRes = await axios.get(
          "https://maps.googleapis.com/maps/api/directions/json",
          {
            params: {
              origin: originStr,
              destination: destStr,
              mode: "driving",
              key: API_KEY,
            },
          }
        );
        console.log(`[Route Debug] Driving API Response status: ${drivingRes.data.status}`);
        if (drivingRes.data.status === "OK" && drivingRes.data.routes?.[0]?.legs?.[0]) {
          const leg = drivingRes.data.routes[0].legs[0];
          const steps = leg.steps.map((s: any) => s.html_instructions.replace(/<[^>]+>/g, ""));
          return {
            duration: leg.duration.value,
            durationText: leg.duration.text,
            instructions: `Drive ${leg.duration.text} via ${steps.slice(0, 2).join(" -> ")}${steps.length > 2 ? "..." : ""}`,
          };
        }
      }
      return { duration: Infinity, instructions: `No route found (${res.data.status})` };
    }

    const leg = res.data.routes[0]?.legs[0];
    if (!leg) {
      console.warn(`[Route Debug] No legs found in directions response. Routes:`, res.data.routes?.length || 0);
      return { duration: Infinity, instructions: "No route found (no legs)" };
    }
    
    console.log(`[Route Debug] Route found! Duration: ${leg.duration.text}, Distance: ${leg.distance.text}`);

    // Build detailed instructions based on travel mode
    const steps = leg.steps.map((s: any) => {
      if (s.travel_mode === "TRANSIT" && s.transit_details) {
        const td = s.transit_details;
        const line = td.line;
        const vehicle = line.vehicle.type; // BUS, SUBWAY, etc.
        const shortName = line.short_name || line.name;

        return `${vehicle} ${shortName} from ${td.departure_stop.name} -> ${td.arrival_stop.name}`;
      } else if (s.travel_mode === "DRIVING") {
        // Driving instructions (strip HTML tags)
        return s.html_instructions.replace(/<[^>]+>/g, "");
      } else {
        // Walking instructions (strip HTML tags)
        return s.html_instructions.replace(/<[^>]+>/g, "");
      }
    });

    // Format instructions based on mode
    let formattedInstructions = steps.join(" -> ");
    if (mode === "driving") {
      formattedInstructions = `Drive ${leg.duration.text} via ${steps.slice(0, 2).join(" -> ")}${steps.length > 2 ? "..." : ""}`;
    }

    return {
        duration: leg.duration.value, // seconds
        durationText: leg.duration.text, // "21 mins"
        instructions: formattedInstructions,
    };
  } catch (err) {
    console.error("Error fetching directions:", err);
    return { duration: Infinity, instructions: "API error" };
  }
};


// Build graph for all places (excluding meals)
export const buildTravelGraph = async (
  userCoords: { lat: number; lng: number },
  places: any[],
  mode: "transit" | "driving" = "transit"
) => {
  try {
    console.log("[Route Debug] Building travel graph for", places.length, "places");
    console.log("[Route Debug] User coords:", userCoords);
    console.log("[Route Debug] Places sample (first 3):", places.slice(0, 3).map(p => ({
      name: p.name,
      lat: p.lat || p.coordinates?.lat,
      lng: p.lng || p.coordinates?.lng
    })));
    
    const graph: Record<string, Record<string, { time: number; instructions: string }>> = {};
    const allNodes = [{ name: "UserStart", ...userCoords }, ...places];

    // Limit the number of places to prevent API rate limits and long processing times
    const maxPlaces = 8; // Reasonable limit for multi-day planning
    const limitedNodes = allNodes.slice(0, maxPlaces + 1); // +1 for UserStart
    
    if (allNodes.length > maxPlaces + 1) {
      console.warn(`Limiting travel graph to ${maxPlaces} places to prevent API overload`);
    }

    for (let i = 0; i < limitedNodes.length; i++) {
      const nodeName = limitedNodes[i].name || `Place_${i}`;
      graph[nodeName] = {};
      
      for (let j = 0; j < limitedNodes.length; j++) {
        if (i === j) continue;

        try {
          const originNode = limitedNodes[i];
          const destNode = limitedNodes[j];
          
          // Validate coordinates
          if (!originNode.lat || !originNode.lng || !destNode.lat || !destNode.lng) {
            console.warn(`[Route Debug] Invalid coordinates - Origin: lat=${originNode.lat}, lng=${originNode.lng}, Dest: lat=${destNode.lat}, lng=${destNode.lng}`);
            const targetName = limitedNodes[j].name || `Place_${j}`;
            graph[nodeName][targetName] = {
              time: 15 * 60, // 15 minutes fallback
              instructions: "Estimated travel time (invalid coordinates)",
            };
            continue;
          }
          
          console.log(`[Route Debug] Getting travel time: ${nodeName} -> ${limitedNodes[j].name || `Place_${j}`}`);
          const { duration, instructions } = await getTravelTime(originNode, destNode, mode);
          const targetName = limitedNodes[j].name || `Place_${j}`;
          
          if (duration === Infinity) {
            console.warn(`[Route Debug] Route returned Infinity, using fallback for ${nodeName} -> ${targetName}`);
            graph[nodeName][targetName] = {
              time: 15 * 60, // 15 minutes fallback
              instructions: instructions || "Estimated travel time (route not found)",
            };
          } else {
            graph[nodeName][targetName] = {
              time: duration,
              instructions,
            };
            console.log(`[Route Debug] Successfully got route: ${nodeName} -> ${targetName}, time: ${Math.round(duration / 60)} min`);
          }
          
          // Add small delay to prevent API rate limiting
          if (i > 0 || j > 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error: any) {
          console.error(`[Route Debug] Failed to get travel time from ${nodeName} to ${limitedNodes[j].name}:`, error?.message || error);
          const targetName = limitedNodes[j].name || `Place_${j}`;
          graph[nodeName][targetName] = {
            time: 15 * 60, // 15 minutes fallback
            instructions: `Estimated travel time (error: ${error?.message || 'unknown'})`,
          };
        }
      }
    }

    console.log("[Route Debug] Travel graph built successfully");
    console.log(`[Route Debug] Graph has ${Object.keys(graph).length} nodes`);
    
    // Log a sample of the graph to verify structure
    const sampleNode = Object.keys(graph)[0];
    if (sampleNode) {
      const sampleConnections = Object.keys(graph[sampleNode]);
      console.log(`[Route Debug] Sample node "${sampleNode}" has ${sampleConnections.length} connections`);
      if (sampleConnections.length > 0) {
        const sampleConnection = graph[sampleNode][sampleConnections[0]];
        console.log(`[Route Debug] Sample connection "${sampleNode}" -> "${sampleConnections[0]}": time=${sampleConnection.time}s, instructions="${sampleConnection.instructions?.substring(0, 50)}..."`);
      }
    }
    
    return { graph, nodes: limitedNodes };
  } catch (error) {
    console.error("Failed to build travel graph:", error);
    // Return a minimal fallback graph
    const fallbackGraph: Record<string, Record<string, { time: number; instructions: string }>> = {};
    const allNodes = [{ name: "UserStart", ...userCoords }, ...places.slice(0, 5)];
    
    for (let i = 0; i < allNodes.length; i++) {
      const nodeName = allNodes[i].name || `Place_${i}`;
      fallbackGraph[nodeName] = {};
      for (let j = 0; j < allNodes.length; j++) {
        if (i === j) continue;
        const targetName = allNodes[j].name || `Place_${j}`;
        fallbackGraph[nodeName][targetName] = {
          time: 15 * 60, // 15 minutes fallback
          instructions: "Estimated travel time",
        };
      }
    }
    
    return { graph: fallbackGraph, nodes: allNodes };
  }
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
        if (!travelData) {
          console.warn(`[Route Debug] No travel data in graph from ${current} to ${candidate.name}`);
          return best;
        }
        if (!best || travelData.time < best.time) {
          return { place: candidate, ...travelData };
        }
        return best;
      }, null as any);

    if (!next) {
      console.warn(`[Route Debug] No next place found. Visited: ${visited.size}/${places.length}`);
      break;
    }

    const travelMinutes = Math.round(next.time / 60);
    console.log(`[Route Debug] Travel from ${current} to ${next.place.name}: ${travelMinutes} min (${next.time} seconds)`);
    
    currentTime += travelMinutes; // travel
    const start = minutesToTime(currentTime);

    currentTime += Math.round(next.place.preferredDuration || 60); // visit duration
    const end = minutesToTime(currentTime);

    const pathItem = {
        ...next.place,
        start_time: start,
        end_time: end,
        travel_time_minutes: travelMinutes,
        travel_time_text: next.durationText, // new
        travel_instructions: next.instructions,
    };
    
    console.log(`[Route Debug] Added to path: ${next.place.name}, travel_time_minutes: ${pathItem.travel_time_minutes}`);
    path.push(pathItem);


    visited.add(next.place.name);
    current = next.place.name;
  }

  return path;
};
