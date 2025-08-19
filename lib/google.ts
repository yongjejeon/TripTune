import axios from "axios";
import { INDOOR_KEYWORDS, OUTDOOR_KEYWORDS } from "./constants";
import { getUserPreferences } from "./preferences";

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;

const DEFAULT_PREFERENCES = {
  museum: { weight: 5, duration: 60 },
  art_gallery: { weight: 5, duration: 60 },
  historical_sites: { weight: 5, duration: 60 },
  religious_sites: { weight: 5, duration: 60 },
  park: { weight: 5, duration: 60 },
  beaches: { weight: 5, duration: 60 },
  cafe: { weight: 5, duration: 60 },
  shopping: { weight: 5, duration: 60 },
  zoo: { weight: 5, duration: 60 },
  aquarium: { weight: 5, duration: 60 },
  nightlife: { weight: 5, duration: 60 },
  amusement_park: { weight: 5, duration: 60 },
  sports: { weight: 5, duration: 60 },
  spa: { weight: 5, duration: 60 },
};

const CATEGORY_MAP: Record<string, string> = {
  museum: "museum",
  art_gallery: "art_gallery",
  historical_sites: "point_of_interest",
  religious_sites: "place_of_worship",
  park: "park",
  beaches: "tourist_attraction",
  cafe: "cafe",
  shopping: "shopping_mall",
  zoo: "zoo",
  aquarium: "aquarium",
  nightlife: "night_club",
  amusement_park: "amusement_park",
  sports: "stadium",
  spa: "spa",
};

const fetchPlacesByType = async (lat: number, lng: number, type: string, limit: number) => {
  const res = await axios.get(
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
    {
      params: {
        location: `${lat},${lng}`,
        radius: 5000,
        type,
        key: API_KEY,
      },
    }
  );
  return (res.data.results || []).slice(0, limit);
};

// lib/google.ts

export const fetchPlacesByCoordinates = async (lat: number, lng: number) => {
  const prefs = (await getUserPreferences()) || { preferences: DEFAULT_PREFERENCES };

  let allResults: any[] = [];

  const touristResults = await fetchPlacesByType(lat, lng, "tourist_attraction", 20);
  allResults.push(...touristResults);

  const totalWeight =
    Object.entries(prefs?.preferences ?? DEFAULT_PREFERENCES)
      .filter(([key]) => key !== "restaurant")
      .reduce((sum, [, pref]: any) => sum + (pref?.weight ?? 1), 0) || 1;

  for (const [key, pref] of Object.entries(prefs?.preferences ?? DEFAULT_PREFERENCES)) {
    if (key === "restaurant") continue;
    const type = CATEGORY_MAP[key];
    if (!type) continue;

    const quota = Math.max(2, Math.round(((pref?.weight ?? 1) / totalWeight) * 30));
    if (quota > 0) {
      const results = await fetchPlacesByType(lat, lng, type, quota);
      allResults.push(...results);
    }
  }

  let uniqueResults = Array.from(new Map(allResults.map(p => [p.place_id, p])).values());

  if (uniqueResults.length < 50) {
    const needed = 50 - uniqueResults.length;
    const fallbackResults = await fetchPlacesByType(lat, lng, "tourist_attraction", needed);
    const combined = [...uniqueResults, ...fallbackResults];
    uniqueResults = Array.from(new Map(combined.map(p => [p.place_id, p])).values());
  }

  const places = uniqueResults
    .filter((p: any) => p.rating && p.user_ratings_total)
    .map((place: any) => {
      const types = place.types || [];
      const isIndoor = types.some((t: string) => INDOOR_KEYWORDS.includes(t));
      const isOutdoor = types.some((t: string) => OUTDOOR_KEYWORDS.includes(t));

      let category = "unknown";
      if (isIndoor && isOutdoor) category = "both";
      else if (isIndoor) category = "indoor";
      else if (isOutdoor) category = "outdoor";

      let interestWeight = 1;
      let preferredDuration = 60;
      if (prefs?.preferences) {
        for (const key of Object.keys(prefs.preferences)) {
          if (types.includes(key) && key !== "restaurant") {
            interestWeight = prefs.preferences[key].weight || 1;
            preferredDuration = prefs.preferences[key].duration || 60;
            break;
          }
        }
      }

      const score =
        place.rating * place.user_ratings_total * (interestWeight / 5);

      return {
        ...place,
        lat: place.geometry?.location?.lat || null,
        lng: place.geometry?.location?.lng || null,
        category,
        interestWeight,
        preferredDuration,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  return places.slice(0, 50);
};


// Later, for meal breaks
export const fetchNearestRestaurant = async (lat: number, lng: number) => {
  return await fetchPlacesByType(lat, lng, "restaurant", 10); // fetch top 10 nearby restaurants
};

// lib/google.ts

export const makeCompactPlacesList = (places: any[]) => {
  return places
    .slice(0, 20) // keep top 20 to reduce token use
    .map((p, idx) => ({
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

