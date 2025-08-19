// lib/locations.ts
import * as Location from "expo-location";

export async function detectUserLocation() {
  let { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Permission denied for location access");
  }

  const loc = await Location.getCurrentPositionAsync({});
  const { latitude, longitude } = loc.coords;

  // Reverse geocode
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${process.env.EXPO_PUBLIC_GOOGLE_API_KEY}`
  );
  const data = await res.json();

  if (!data.results || data.results.length === 0) {
    throw new Error("Could not detect city from location");
  }

  const components = data.results[0].address_components;
  const cityComponent =
    components.find((c: any) => c.types.includes("locality")) ||
    components.find((c: any) =>
      c.types.includes("administrative_area_level_2")
    ) ||
    components.find((c: any) =>
      c.types.includes("administrative_area_level_1")
    );

  const city = cityComponent?.long_name ?? null;

  return {
    lat: latitude,
    lng: longitude,
    city,
  };
}
