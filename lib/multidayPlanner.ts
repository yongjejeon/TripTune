// lib/multidayPlanner.ts
import { fetchPlacesByCoordinates } from "@/lib/google";
import generateItinerary from "@/lib/itineraryAI";
import { reconstructItinerary } from "@/lib/itineraryOptimizer";
import { getUserPreferences } from "@/lib/preferences";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Helper function to prioritize places based on user preferences
function prioritizePlacesByPreferences(places: any[], prefs: any): any[] {
  if (!prefs?.preferences || !Array.isArray(prefs.preferences)) return places;
  
  const preferences = prefs.preferences;
  const prioritized = places.map(place => {
    let score = place.score || 0;
    
    // Boost score based on user preferences
    if (preferences.includes('museums') && place.category?.includes('museum')) {
      score += 20;
    }
    if (preferences.includes('parks') && place.category?.includes('park')) {
      score += 15;
    }
    if (preferences.includes('restaurants') && place.category?.includes('restaurant')) {
      score += 10;
    }
    if (preferences.includes('shopping') && place.category?.includes('shopping')) {
      score += 10;
    }
    if (preferences.includes('nightlife') && place.category?.includes('bar')) {
      score += 10;
    }
    
    return { ...place, score };
  });
  
  return prioritized.sort((a, b) => (b.score || 0) - (a.score || 0));
}

type LatLng = { lat: number; lng: number };
type ItinItem = {
  order: number; place_id: string|null; name: string; category: string;
  lat: number; lng: number; start_time: string; end_time: string;
  estimated_duration: number; travel_time_minutes: number;
  travel_instructions?: string; reason?: string;
};
export type DayPlan = { date: string; anchorIds: string[]; itinerary: ItinItem[]; pool?: any[] };
export type TripPlan = { startDate: string; endDate: string; homebase: LatLng; days: DayPlan[] };
export type MultiDayProgressUpdate = { stage: string; message: string; detail?: string; progress?: number };
const MAX_DAY_CANDIDATES = 16;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const buildDaysLocal = (sISO: string, eISO: string) => {
  const s = new Date(sISO + "T00:00:00"); const e = new Date(eISO + "T00:00:00");
  const out: string[] = []; for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(ymd(d));
  return out;
};

// Enhanced anchor draft: must-sees first, then top unused, with proper duplicate prevention
function draftAnchors(days: string[], places: any[], mustIds: Set<string>, maxPerDay = 1) {
  const byScore = places.slice().sort((a,b) => (b.score ?? 0) - (a.score ?? 0));
  const anchors: Record<string,string[]> = Object.fromEntries(days.map(d => [d, []]));
  const used = new Set<string>();
  
  // First pass: assign must-see places (one per day, round-robin)
  const mustSeePlaces = byScore.filter(p => mustIds.has(p.place_id));
  let mustSeeIndex = 0;
  
  for (let dayIndex = 0; dayIndex < days.length && mustSeeIndex < mustSeePlaces.length; dayIndex++) {
    const day = days[dayIndex];
    if (anchors[day].length >= maxPerDay) continue;
    
    // Find next unused must-see place
    while (mustSeeIndex < mustSeePlaces.length && used.has(mustSeePlaces[mustSeeIndex].place_id)) {
      mustSeeIndex++;
    }
    
    if (mustSeeIndex < mustSeePlaces.length) {
      const place = mustSeePlaces[mustSeeIndex];
      anchors[day].push(place.place_id);
      used.add(place.place_id);
      mustSeeIndex++;
      console.log(`Assigned must-see "${place.name}" to day ${day}`);
    }
  }
  
  // Second pass: assign top-rated places to remaining days
  const remainingPlaces = byScore.filter(p => !mustIds.has(p.place_id) && !used.has(p.place_id));
  let placeIndex = 0;
  
  for (const day of days) {
    if (anchors[day].length >= maxPerDay) continue;
    
    // Find next unused place
    while (placeIndex < remainingPlaces.length && used.has(remainingPlaces[placeIndex].place_id)) {
      placeIndex++;
    }
    
    if (placeIndex < remainingPlaces.length) {
      const place = remainingPlaces[placeIndex];
      anchors[day].push(place.place_id);
      used.add(place.place_id);
      placeIndex++;
      console.log(`Assigned top place "${place.name}" to day ${day}`);
    }
  }
  
  console.log("Anchor assignment summary:", {
    totalDays: days.length,
    daysWithAnchors: Object.values(anchors).filter(dayAnchors => dayAnchors.length > 0).length,
    totalAnchors: Object.values(anchors).reduce((sum, dayAnchors) => sum + dayAnchors.length, 0),
    usedPlaces: used.size
  });
  
  return anchors;
}

export async function planMultiDayTrip(options?: { onStatus?: (update: MultiDayProgressUpdate) => void }): Promise<TripPlan> {
  try {
    console.log("Starting multi-day trip planning...");
    const emit = (stage: string, message: string, progress?: number, detail?: string) => {
      options?.onStatus?.({ stage, message, progress, detail });
    };

    emit("init", "Reading trip setup...", 0.02);

    // 1) read context
    const rawCtx = await AsyncStorage.getItem("tripContext");
    if (!rawCtx) {
      throw new Error("Trip dates not set. Please complete the onboarding process first.");
    }
    
    const ctx = JSON.parse(rawCtx);
    const startDate: string = ctx.startDate;
    const endDate: string = ctx.endDate;
    const itineraryStartTime: string | undefined =
      typeof ctx.itineraryStartTime === "string" ? ctx.itineraryStartTime : undefined;
    emit("context", "Trip details loaded", 0.08, `${startDate} to ${endDate}`);
    
    if (!startDate || !endDate) {
      throw new Error("Invalid trip dates. Please set start and end dates.");
    }
    
    const days: string[] = (ctx.days && ctx.days.length) ? ctx.days : buildDaysLocal(startDate, endDate);
    const homebase: LatLng = ctx.homebase;
    emit("context", `Planning ${days.length} day${days.length === 1 ? "" : "s"}`, 0.12);
    
    if (!homebase?.lat || !homebase?.lng) {
      throw new Error("Homebase coordinates missing. Please detect your location first.");
    }

    console.log("Trip context:", { startDate, endDate, days: days.length, homebase });

    // 2) prefs + places once
    emit("preferences", "Loading saved preferences...", 0.18);
    const prefs = await getUserPreferences();
    console.log("User preferences loaded:", { 
      hasPrefs: !!prefs.preferences, 
      mustSeeCount: prefs.mustSee?.length || 0 
    });
    emit("preferences", `Preferences ready (${prefs.mustSee?.length || 0} must-see selections)`, 0.22);

    emit("places", "Finding top attractions near your stay...", 0.28);
    const rawPlaces = await fetchPlacesByCoordinates(homebase.lat, homebase.lng);
    console.log("Places fetched:", rawPlaces.length);
    emit("places", `Fetched ${rawPlaces.length} places`, 0.34);

    if (!rawPlaces || rawPlaces.length === 0) {
      throw new Error("No places found near your location. Please try a different location.");
    }

    // Filter out avoided places
    emit("filter", "Applying your avoid list...", 0.38);
    const avoidPlaces = prefs?.avoidPlaces || [];
    const filteredPlaces = rawPlaces.filter(place => {
      const placeName = place.name?.toLowerCase() || '';
      const placeId = place.place_id || '';
      
      // Check if this place should be avoided
      const shouldAvoid = avoidPlaces.some(avoidItem => {
        const avoidLower = avoidItem.toLowerCase();
        return placeName.includes(avoidLower) || 
               placeId === avoidItem ||
               placeName === avoidLower;
      });
      
      if (shouldAvoid) {
        console.log(`Filtering out avoided place: "${place.name}"`);
        return false;
      }
      return true;
    });
    
    console.log(`Filtered places: ${rawPlaces.length} to ${filteredPlaces.length} (removed ${rawPlaces.length - filteredPlaces.length} avoided places)`);
    emit("filter", `Filtered to ${filteredPlaces.length} candidate places`, 0.42);
    
    // Prioritize places based on user preferences
    emit("prioritize", "Prioritizing locations based on your interests...", 0.48);
    console.log("User preferences structure:", { 
      hasPrefs: !!prefs, 
      hasPreferences: !!prefs?.preferences,
      preferencesType: typeof prefs?.preferences,
      preferencesValue: prefs?.preferences,
      avoidPlacesCount: avoidPlaces.length
    });
    
    const places = prioritizePlacesByPreferences(filteredPlaces, prefs);
    console.log("Places prioritized by user preferences:", places.length);
    emit("prioritize", `Top ${places.length} places prioritized`, 0.52);

    // 3) anchor assignment
    emit("anchors", "Assigning must-see anchors for each day...", 0.56);
    const mustSet = new Set<string>(Array.isArray(prefs?.mustSee) ? prefs.mustSee : []);
    const anchorsByDay = draftAnchors(days, places, mustSet, 1);
    console.log("Anchors assigned:", Object.keys(anchorsByDay).length, "days");
    emit("anchors", `Anchors ready for ${days.length} day${days.length === 1 ? "" : "s"}`, 0.6);

    // 4) Multi-stage per-day generation with explicit place filtering
    const used = new Set<string>();
    const outDays: DayPlan[] = [];
    
    // Pre-mark anchor places as used to prevent them from appearing in other days
    Object.values(anchorsByDay).forEach(dayAnchors => {
      dayAnchors.forEach(anchorId => used.add(anchorId));
    });
    
    console.log("Pre-marked anchor places as used:", used.size);
    
    for (let i = 0; i < days.length; i++) {
      const date = days[i];
      console.log(`Planning day ${i + 1}/${days.length}: ${date}`);
      const dayStartProgress = 0.6 + (i / Math.max(days.length, 1)) * 0.3;
      emit(
        `day-${i + 1}`,
        `Planning Day ${i + 1} (${date})`,
        Math.min(dayStartProgress, 0.9),
        `${used.size} places already reserved`
      );
      
      const anchorIds = anchorsByDay[date] || [];
      
      // Create explicit available places list for this day
      const availablePlaces = places.filter(p => {
        // Include if it's an anchor for this day
        if (anchorIds.includes(p.place_id)) return true;
        // Include if it hasn't been used in any previous day
        if (!used.has(p.place_id)) return true;
        return false;
      });
      
      console.log(`Day ${date} available places: ${availablePlaces.length} places (${anchorIds.length} anchors)`);
      console.log(`Available places for day ${date}:`, availablePlaces.map(p => p.name));

      const sortedByScore = availablePlaces
        .slice()
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

      const candidateSet = new Map<string | undefined, any>();
      sortedByScore.forEach((place) => {
        if (!candidateSet.has(place.place_id)) {
          candidateSet.set(place.place_id, place);
        }
      });

      anchorIds.forEach((anchorId) => {
        const anchorPlace = availablePlaces.find((p) => p.place_id === anchorId);
        if (anchorPlace && !candidateSet.has(anchorId)) {
          candidateSet.set(anchorId, anchorPlace);
        }
      });

      const dayCandidates = Array.from(candidateSet.values()).slice(0, MAX_DAY_CANDIDATES);

      if (!dayCandidates.length) {
        console.warn(`No shortlisted candidates for day ${date}, skipping...`);
        outDays.push({ date, anchorIds, itinerary: [] });
        continue;
      }

      try {
        // Generate itinerary for this day using ONLY the available places
        console.log(`Calling AI with ${dayCandidates.length} shortlisted places for day ${date}`);
        const ai = await generateItinerary(dayCandidates, homebase, { 
          date,
          availablePlaces: dayCandidates.map(p => p.name), // Explicitly tell AI which places are available
          usedPlaces: Array.from(used).map(id => {
            const place = places.find(p => p.place_id === id);
            return place ? place.name : id;
          }),
          anchorPlaces: anchorIds.map(id => {
            const place = places.find(p => p.place_id === id);
            return place ? place.name : id;
          }) // Tell AI about the anchor places for this day
        });
        let rawList: ItinItem[] = ai?.itinerary ?? [];
        
        console.log(`AI returned ${rawList.length} items for day ${date}:`, 
          rawList.map(item => `${item.name} (${item.category})`));
        
        if (!rawList || rawList.length === 0) {
          console.warn(`AI returned empty itinerary for day ${date}`);
          outDays.push({ date, anchorIds, itinerary: [] });
          continue;
        }

        // Ensure we have enough activities for a full day
        if (rawList.length < 4) {
          console.warn(`Day ${date} has only ${rawList.length} activities, trying to add more...`);
          
          // Find additional places that haven't been used
          const additionalPlaces = dayCandidates.filter(p => 
            !rawList.some(item => item.place_id === p.place_id)
          ).slice(0, 4 - rawList.length);
          
          if (additionalPlaces.length > 0) {
            console.log(`Adding ${additionalPlaces.length} additional places to day ${date}:`, 
              additionalPlaces.map(p => p.name));
            additionalPlaces.forEach((place, index) => {
              rawList.push({
                order: rawList.length + index + 1,
                place_id: place.place_id,
                name: place.name,
                category: place.normalizedCategory || place.category || "attraction",
                lat: place.lat || place.geometry?.location?.lat || 0,
                lng: place.lng || place.geometry?.location?.lng || 0,
                start_time: "10:00",
                end_time: "11:00",
                estimated_duration: place.preferredDuration || 90,
                travel_time_minutes: 0,
                travel_instructions: "Walk ~5 min",
                reason: "Added to complete day itinerary"
              });
            });
          } else {
            console.warn(`No additional places available for day ${date}`);
          }
        }
        
        // Mark all places used in this day's itinerary
        const dayUsedPlaces = new Set<string>();
        
        rawList.forEach(item => { 
          if (item.place_id) {
            used.add(item.place_id);
            dayUsedPlaces.add(item.place_id);
          }
        });
        
        console.log(`Day ${date} used ${dayUsedPlaces.size} places:`, 
          Array.from(dayUsedPlaces).map(id => {
            const place = places.find(p => p.place_id === id);
            return place ? place.name : id;
          })
        );

        // Map AI-generated place names back to full place objects with coordinates
        const enrichedList = rawList.map((item: any) => {
          if (item.category === 'meal') {
            return item; // Keep meals as-is
          }
          
          // Find the full place object with coordinates
          const fullPlace = places.find(p => p.name === item.name);
          if (fullPlace) {
            return {
              ...item,
              coordinates: { lat: fullPlace.lat, lng: fullPlace.lng },
              lat: fullPlace.lat,
              lng: fullPlace.lng,
              place_id: fullPlace.place_id,
              photoUrl: fullPlace.photoUrl,
              rating: fullPlace.rating,
              user_ratings_total: fullPlace.user_ratings_total
            };
          }
          
          console.warn(`Could not find coordinates for place: ${item.name}`);
          return item;
        });

        const optimized = await reconstructItinerary(homebase, enrichedList, { startTime: itineraryStartTime });

        // Build leftover pool for quick replacements (prioritized, unused for this day and globally)
        const optimizedIds = new Set<string>(optimized.map((it: any) => it.place_id).filter(Boolean));
        const dayLeftover = availablePlaces
          .filter(p => !optimizedIds.has(p.place_id) && !used.has(p.place_id))
          .slice() // copy
          .sort((a, b) => (b._prefScore ?? b.score ?? 0) - (a._prefScore ?? a.score ?? 0));

        const pool = dayLeftover.slice(0, 30).map(p => ({
          place_id: p.place_id,
          name: p.name,
          lat: p.lat ?? p.geometry?.location?.lat ?? null,
          lng: p.lng ?? p.geometry?.location?.lng ?? null,
          photoUrl: p.photoUrl ?? null,
          rating: p.rating ?? null,
          vicinity: p.vicinity ?? "",
          category: p.normalizedCategory || p.category || "attraction",
          user_ratings_total: p.user_ratings_total ?? null,
        }));

        outDays.push({ date, anchorIds, itinerary: optimized, pool });
        
        console.log(`Day ${date} planned: ${optimized.length} activities`);
        const dayEndProgress = 0.6 + ((i + 1) / Math.max(days.length, 1)) * 0.3;
        emit(
          `day-${i + 1}-complete`,
          `Day ${i + 1} planned (${optimized.length} activities)`,
          Math.min(dayEndProgress, 0.92)
        );
      } catch (dayError) {
        console.error(`Error planning day ${date}:`, dayError);
        // Continue with other days even if one fails
        outDays.push({ date, anchorIds, itinerary: [] });
      }
    }

    const result = { startDate, endDate, homebase, days: outDays };
    
    // 5) Final validation: check for duplicates
    const allPlaceIds = new Set<string>();
    const duplicates: string[] = [];
    
    result.days.forEach((day, dayIndex) => {
      day.itinerary.forEach(item => {
        if (item.place_id) {
          if (allPlaceIds.has(item.place_id)) {
            duplicates.push(`${item.name} (Day ${dayIndex + 1})`);
          } else {
            allPlaceIds.add(item.place_id);
          }
        }
      });
    });
    
    if (duplicates.length > 0) {
      console.warn("Duplicates detected in final result:", duplicates);
    } else {
      console.log("No duplicates found in final result");
    }
    emit("finalize", "Finalizing trip plan...", 0.96);
    console.log("Multi-day trip planning completed:", {
      days: result.days.length,
      totalActivities: result.days.reduce((sum, day) => sum + day.itinerary.length, 0),
      uniquePlaces: allPlaceIds.size,
      duplicates: duplicates.length
    });
    emit("complete", "Multi-day itinerary ready!", 1);
    
    return result;
  } catch (error) {
    console.error("Multi-day trip planning failed:", error);
    throw error;
  }
}
