// screens/Index.tsx
import { fetchPlacesByCoordinates, makeCompactPlacesList } from "@/lib/google"; // ✅ Correct import
import * as Location from "expo-location";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const FILTERS = ["all", "indoor", "outdoor"] as const;
type FilterType = (typeof FILTERS)[number];

export default function Index() {
  const [city, setCity] = useState("");
  const [places, setPlaces] = useState<any[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );

  // 📌 Detect user location and fetch POIs
  const detectLocation = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Denied",
          "Location access is required to detect nearby places."
        );
        return;
      }

      const loc = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = loc.coords;
      setCoords({ lat: latitude, lng: longitude });

      // Reverse geocode to get city name
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${process.env.EXPO_PUBLIC_GOOGLE_API_KEY}`
      );
      const data = await res.json();

      if (!data.results || data.results.length === 0) {
        Alert.alert("Error", "Could not detect city from location");
        return;
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

      if (cityComponent?.long_name) {
        setCity(cityComponent.long_name);
        loadPlaces(latitude, longitude); // fetch POIs automatically
      }
    } catch (err) {
      console.error("Location detection error:", err);
      Alert.alert("Error", "Failed to detect location");
    }
  };

  // 📌 Load nearby places using detected coordinates
  const loadPlaces = async (lat?: number, lng?: number) => {
    try {
      const targetLat = lat ?? coords?.lat;
      const targetLng = lng ?? coords?.lng;

      if (!targetLat || !targetLng) {
        Alert.alert(
          "Error",
          "No coordinates available. Please detect location first."
        );
        return;
      }

      setLoading(true);
      console.log(`🔍 Fetching POIs near: ${targetLat}, ${targetLng}`);

      const results = await fetchPlacesByCoordinates(targetLat, targetLng);
      setPlaces(results);
      // 🔥 Show compact list for AI in console
      const compactList = makeCompactPlacesList(results);
      console.log("📝 Compact List for AI:\n", compactList);
    } catch (err: any) {
      console.error("Error loading places:", err);
      Alert.alert("Error", err?.message || "Failed to fetch places");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    detectLocation(); // Auto-detect location on mount
  }, []);

  // ✅ Apply filter logic
  const filteredPlaces =
    filter === "all"
      ? places
      : places.filter((p) => p.category === filter || p.category === "both");

  return (
    <SafeAreaView className="h-full bg-white">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-32 px-7"
      >
        <Text className="text-2xl font-rubik-bold mb-4">
          Top Places Near You
        </Text>

        <TextInput
          placeholder="Enter a city (optional)"
          value={city}
          onChangeText={setCity}
          className="border px-4 py-2 rounded mb-4 border-gray-300"
        />

        <View className="flex-row justify-between mb-6">
          <TouchableOpacity
            onPress={detectLocation}
            className="bg-gray-200 py-2 px-4 rounded"
          >
            <Text className="font-rubik-semibold">Use My Location</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => coords && loadPlaces(coords.lat, coords.lng)}
            className="bg-primary-100 py-2 px-4 rounded"
          >
            <Text className="text-white font-rubik-semibold">Search</Text>
          </TouchableOpacity>
        </View>

        <View className="flex-row justify-around mb-6">
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              className={`px-4 py-2 rounded-full ${
                f === filter ? "bg-primary-100" : "bg-gray-200"
              }`}
            >
              <Text
                className={`text-sm ${
                  f === filter ? "text-white" : "text-black"
                }`}
              >
                {f.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <View className="items-center justify-center">
            <ActivityIndicator size="large" color="#0061ff" />
            <Text className="text-gray-500 mt-4">Loading POIs...</Text>
          </View>
        ) : filteredPlaces.length === 0 ? (
          <Text className="text-gray-500 text-center font-rubik-semibold">
            No places found for this filter.
          </Text>
        ) : (
          filteredPlaces.map((place, idx) => (
            <View key={idx} className="mb-4 border-b pb-4 border-gray-200">
              <Text className="text-lg font-rubik-bold">{place.name}</Text>
              <Text className="text-sm text-gray-500 font-rubik-semibold">
                {place.vicinity || place.address}
              </Text>
              <Text className="text-sm font-rubik-semibold">
                ⭐️ {place.rating} ({place.user_ratings_total} reviews)
              </Text>
              <Text className="text-sm text-primary-100 capitalize font-rubik-semibold">
                Category: {place.category}
              </Text>
              <Text className="text-sm text-gray-600 font-rubik">
                Suggested Duration: {place.preferredDuration} mins
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
