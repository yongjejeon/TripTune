import axios from 'axios';
import { getCoordinatesFromCity } from './google';

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

const fetchNearby = async (
  location: string,
  type: string,
  radius = 2000
) => {
  const res = await axios.get(
    'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
    {
      params: {
        location,
        radius,
        type,
        key: API_KEY,
      },
    }
  );
  return res.data.results || [];
};

const isNotDuplicate = (itinerary: any[], place: any) =>
  !itinerary.some(p => p.place_id === place.place_id);

export async function generateItinerary(city: string) {
  try {
    console.log('Generating itinerary for:', city);
    const coordsStr = await getCoordinatesFromCity(city);

    const itinerary: any[] = [];

    // 1. First attraction
    const allAttractions = await fetchNearby(coordsStr, 'tourist_attraction', 5000);
    const topPlace = allAttractions
      .filter((p:any) => p.rating && p.user_ratings_total)
      .sort((a:any, b:any) =>
        (b.rating * b.user_ratings_total) - (a.rating * a.user_ratings_total)
      )[0];
    if (!topPlace) throw new Error('No top attraction found');
    itinerary.push(topPlace);

    const topCoords = `${topPlace.geometry.location.lat},${topPlace.geometry.location.lng}`;

    // 2. Restaurant near top
    await sleep(1500);
    const nearbyRestaurants1 = await fetchNearby(topCoords, 'restaurant', 1000);
    const restaurant1 = nearbyRestaurants1
      .filter((p:any) => p.rating && p.user_ratings_total && isNotDuplicate(itinerary, p))
      .sort((a:any, b:any) =>
        (b.rating * b.user_ratings_total) - (a.rating * a.user_ratings_total)
      )[0];
    if (restaurant1) itinerary.push(restaurant1);

    // 3. Second attraction near first
    await sleep(1500);
    const nearbyAttractions1 = await fetchNearby(topCoords, 'tourist_attraction', 2000);
    const secondAttraction = nearbyAttractions1
      .filter((p:any) => p.rating && p.user_ratings_total && isNotDuplicate(itinerary, p))
      .sort((a:any, b:any) =>
        (b.rating * b.user_ratings_total) - (a.rating * a.user_ratings_total)
      )[0];
    if (!secondAttraction) throw new Error('Second attraction not found');
    itinerary.push(secondAttraction);

    const secondCoords = `${secondAttraction.geometry.location.lat},${secondAttraction.geometry.location.lng}`;

    // 4. Café near second attraction
    await sleep(1500);
    const cafes = await fetchNearby(secondCoords, 'cafe', 1500);
    const bestCafe = cafes
      .filter((p:any) => p.rating && p.user_ratings_total && isNotDuplicate(itinerary, p))
      .sort((a:any, b:any) =>
        (b.rating * b.user_ratings_total) - (a.rating * a.user_ratings_total)
      )[0];
    if (bestCafe) itinerary.push(bestCafe);

    // 5. Third attraction near second
    await sleep(1500);
    const nearbyAttractions2 = await fetchNearby(secondCoords, 'tourist_attraction', 2000);
    const thirdAttraction = nearbyAttractions2
      .filter((p:any) => p.rating && p.user_ratings_total && isNotDuplicate(itinerary, p))
      .sort((a:any, b:any) =>
        (b.rating * b.user_ratings_total) - (a.rating * a.user_ratings_total)
      )[0];
    if (thirdAttraction) itinerary.push(thirdAttraction);

    // 6. Final restaurant
    if (thirdAttraction) {
      const thirdCoords = `${thirdAttraction.geometry.location.lat},${thirdAttraction.geometry.location.lng}`;
      await sleep(1500);
      const nearbyRestaurants2 = await fetchNearby(thirdCoords, 'restaurant', 1000);
      const restaurant2 = nearbyRestaurants2
        .filter((p:any) => p.rating && p.user_ratings_total && isNotDuplicate(itinerary, p))
        .sort((a:any, b:any) =>
          (b.rating * b.user_ratings_total) - (a.rating * a.user_ratings_total)
        )[0];
      if (restaurant2) itinerary.push(restaurant2);
    }

    console.log('Final itinerary:');
    itinerary.forEach((p, i) => {
      console.log(`${i + 1}. ${p.name} - ${p.types?.[0]} - ⭐️ ${p.rating}`);
    });

    return itinerary;
  } catch (err) {
    console.error('Failed to generate itinerary:', err);
    return [];
  }
}
