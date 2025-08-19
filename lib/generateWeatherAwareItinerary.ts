// lib/generateItinerary.ts
import {
  classifyPlace,
  fetchClassifiedPlaces,
  fetchNearbyPlacesByType,
  getCoordinatesFromCity,
} from './google';
import { getWeather } from './weather';

const BAD_WEATHER = ['Rain', 'Snow', 'Thunderstorm', 'Drizzle', 'Mist', 'Clouds'];

export async function generateItinerary(city: string) {
  const coordsStr = await getCoordinatesFromCity(city);
  const [lat, lng] = coordsStr.split(',').map(Number);

  const weather = await getWeather(lat, lng);
  console.log(`Weather in ${city}: ${weather}`);

  // Full places with geometry
  const mainPOIs = await fetchNearbyPlacesByType(lat, lng, 'tourist_attraction');
  const restaurants = await fetchNearbyPlacesByType(lat, lng, 'restaurant');
  const cafes = await fetchNearbyPlacesByType(lat, lng, 'cafe');

  // Fetch indoor-only from classified set
  const { indoor: indoorTouristPlaces } = await fetchClassifiedPlaces(city);

  const itinerary: any[] = [];
  const usedPlaceIds = new Set<string>();

  const addPlace = (place: any) => {
    if (place && !usedPlaceIds.has(place.place_id)) {
      itinerary.push(place);
      usedPlaceIds.add(place.place_id);
    }
  };

  // 1. First tourist spot
  let mainPlace = mainPOIs.find((p:any) => p.rating && p.user_ratings_total);
  const category = classifyPlace(mainPlace?.types || []);
  console.log(`Main place category: ${category} - ${mainPlace?.name}`);

  if (BAD_WEATHER.includes(weather) && category === 'outdoor') {
    const indoorReplacement = indoorTouristPlaces.find(p => !usedPlaceIds.has(p.name)); // fallback using name
    if (indoorReplacement) {
      console.warn('Replacing outdoor place due to weather:', mainPlace?.name);
      mainPlace = {
        ...indoorReplacement,
        geometry: { location: { lat, lng } }, // fake location to prevent crash
        place_id: indoorReplacement.name, // use name as fallback id
      };
    }
  }
  addPlace(mainPlace);

  // 2. Restaurant nearby
  const restaurantNear1 = restaurants.find((r:any) =>
    getDistance(r.geometry.location, mainPlace.geometry.location) < 2 &&
    !usedPlaceIds.has(r.place_id)
  );
  addPlace(restaurantNear1);

  // 3. Another tourist spot nearby
  let secondTourist = mainPOIs.find((p:any) =>
    p.place_id !== mainPlace.place_id &&
    getDistance(p.geometry.location, mainPlace.geometry.location) < 2 &&
    !usedPlaceIds.has(p.place_id)
  );
  if (BAD_WEATHER.includes(weather) && classifyPlace(secondTourist?.types || []) === 'outdoor') {
    const indoorAlt = indoorTouristPlaces.find(p => !usedPlaceIds.has(p.name));
    if (indoorAlt) {
      secondTourist = {
        ...indoorAlt,
        geometry: { location: { lat, lng } },
        place_id: indoorAlt.name,
      };
    }
  }
  addPlace(secondTourist);

  // 4. Cafe nearby
  const cafeNear = cafes.find((c:any) =>
    getDistance(c.geometry.location, secondTourist.geometry.location) < 2 &&
    !usedPlaceIds.has(c.place_id)
  );
  addPlace(cafeNear);

  // 5. Final tourist spot nearby
  let thirdTourist = mainPOIs.find((p:any) =>
    !usedPlaceIds.has(p.place_id) &&
    getDistance(p.geometry.location, secondTourist.geometry.location) < 2
  );
  if (BAD_WEATHER.includes(weather) && classifyPlace(thirdTourist?.types || []) === 'outdoor') {
    const indoorAlt = indoorTouristPlaces.find(p => !usedPlaceIds.has(p.name));
    if (indoorAlt) {
      thirdTourist = {
        ...indoorAlt,
        geometry: { location: { lat, lng } },
        place_id: indoorAlt.name,
      };
    }
  }
  addPlace(thirdTourist);

  // 6. Dinner nearby
  const dinner = restaurants.find((r:any) =>
    getDistance(r.geometry.location, thirdTourist.geometry.location) < 2 &&
    !usedPlaceIds.has(r.place_id)
  );
  addPlace(dinner);

  console.log('Final Itinerary:');
  itinerary.forEach((p, i) => {
    console.log(`${i + 1}. ${p.name} - ${p.types?.[0]} - ⭐️ ${p.rating}`);
  });

  return itinerary;
}

function getDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const aVal = Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R * c;
}
