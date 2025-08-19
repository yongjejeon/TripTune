// screens/Explore.tsx
import { fetchPlacesByCoordinates } from "@/lib/google";
import { generateItinerary } from "@/lib/itineraryAI";
import { reconstructItinerary } from "@/lib/itineraryOptimizer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

function haversineDistance(coord1: any, coord2: any) {
  const R = 6371e3; // meters
  const φ1 = (coord1.lat * Math.PI) / 180;
  const φ2 = (coord2.lat * Math.PI) / 180;
  const Δφ = ((coord2.lat - coord1.lat) * Math.PI) / 180;
  const Δλ = ((coord2.lng - coord1.lng) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) *
      Math.cos(φ2) *
      Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // meters
}

export default function Explore() {
  const [loading, setLoading] = useState(false);
  const [rawResult, setRawResult] = useState<any>(null);
  const [optimizedResult, setOptimizedResult] = useState<any>(null);
  const [userLocation, setUserLocation] = useState<any>(null);
  const [currentActivityIdx, setCurrentActivityIdx] = useState<number | null>(null);
   useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 20, // every 20 meters
        },
        (loc) => {
          setUserLocation({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          });
        }
      );
    })();
  }, []);
  useEffect(() => {
    if (!optimizedResult?.itinerary || !userLocation) return;

    const idx = optimizedResult.itinerary.findIndex((item: any) => {
      if (!item.lat || !item.lng) return false;
      const distance = haversineDistance(userLocation, {
        lat: item.lat,
        lng: item.lng,
      });
      return distance <= 100; // within 100m
    });

    setCurrentActivityIdx(idx !== -1 ? idx : 0);
  }, [userLocation, optimizedResult]);
  // 🔹 Generate Itinerary from AI
  const handleGenerate = async () => {
    try {
      setLoading(true);
      setRawResult(null);
      setOptimizedResult(null);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted")
        throw new Error("Location permission not granted");

      const loc = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = loc.coords;

      const places = await fetchPlacesByCoordinates(latitude, longitude);
      const itinerary = await generateItinerary(places, {
        lat: latitude,
        lng: longitude,
      });

      await AsyncStorage.setItem("savedItinerary", JSON.stringify(itinerary));
      setRawResult(itinerary);

      Alert.alert("Success", "Itinerary saved locally!");
    } catch (err: any) {
      console.error("❌ Itinerary generation failed:", err.message);
      setRawResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  // 🔹 View Saved AI Itinerary
  const handleViewSaved = async () => {
    try {
      const saved = await AsyncStorage.getItem("savedItinerary");
      if (saved) {
        setRawResult(JSON.parse(saved));
        console.log("📂 Viewing Saved Itinerary:", saved);
      } else {
        Alert.alert("No Saved Itinerary", "Please generate one first!");
      }
    } catch (err) {
      console.error("❌ Failed to load saved itinerary", err);
    }
  };

  // 🔹 Optimize Saved Itinerary
  const handleOptimize = async () => {
    try {
      const saved = await AsyncStorage.getItem("savedItinerary");
      if (!saved) {
        Alert.alert("Error", "No saved itinerary found.");
        return;
      }

      const parsed = JSON.parse(saved);
      const { itinerary } = parsed;

      const loc = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = loc.coords;

      const optimized = await reconstructItinerary(
        { lat: latitude, lng: longitude },
        itinerary
      );

      const optimizedObj = { itinerary: optimized };
      setOptimizedResult(optimizedObj);

      await AsyncStorage.setItem(
        "optimizedItinerary",
        JSON.stringify(optimizedObj)
      );

      Alert.alert("Success", "Optimized itinerary saved!");
      console.log("✅ Optimized Itinerary:", optimizedObj);
    } catch (err: any) {
      console.error("❌ Optimization failed:", err.message);
      Alert.alert("Error", err.message);
    }
  };

      const formatDuration = (minutes: number) => {
    if (!minutes) return "N/A";
    if (minutes < 60) {
      return `${minutes} min${minutes > 1 ? "s" : ""}`;
    }
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) return `${hrs} hr${hrs > 1 ? "s" : ""}`;
    return `${hrs} hr ${mins} min${mins > 1 ? "s" : ""}`;
  };


  const renderItinerary = (result: any, title: string) => {
  if (!result?.itinerary) return null;

  // Build a synthetic "Home" stop
  const homeBlock = userLocation
    ? [{
        name: "Home",
        category: "start",
        start_time: "09:00",
        end_time: "09:00",
        estimated_duration: 0,
        reason: "Your starting point",
        lat: userLocation.lat,
        lng: userLocation.lng,
      }]
    : [];

  const itineraryWithHome = [...homeBlock, ...result.itinerary];

  return (
    <>
      <Text className="text-xl font-rubik-bold mb-4">{title}</Text>
      {itineraryWithHome.map((item: any, idx: number) => {
        const prev = itineraryWithHome[idx - 1];
        const isFirst = idx === 0;

        // Transit blocks
        const transitBlock =
          !isFirst && prev && item.travel_time_minutes ? (
            <View key={`transit-${idx}`} className="mb-4 p-4 rounded-lg bg-gray-50">
              <Text className="text-base font-rubik-bold text-gray-800">
                {prev.end_time} – {item.start_time} Transit to {item.name}
              </Text>
              <Text className="text-sm text-gray-600">
                Duration: {item.travel_time_minutes} mins
              </Text>
              {item.travel_instructions && (
                <Text className="text-sm text-gray-600 mt-1">
                  {item.travel_instructions}
                </Text>
              )}
            </View>
          ) : null;

        return (
          <View key={idx}>
            {transitBlock}

            {/* Activity */}
            <View
              className={`mb-6 p-4 rounded-lg ${
                idx === currentActivityIdx
                  ? "bg-green-100 border-2 border-green-500"
                  : "bg-white"
              }`}
            >
              <Text
                className={`text-lg font-rubik-bold ${
                  idx === currentActivityIdx ? "text-green-700" : "text-gray-900"
                }`}
              >
                {item.start_time} – {item.end_time} {item.name}
              </Text>

              <Text className="text-sm text-gray-600">
                {item.category.charAt(0).toUpperCase() + item.category.slice(1)}
              </Text>

              {item.estimated_duration > 0 && (
                <Text className="text-sm text-gray-600">
                  Duration: {item.estimated_duration} mins
                </Text>
              )}

              {item.reason && (
                <Text className="text-sm text-gray-500 italic mt-1">
                  {item.reason}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </>
  );
};






  return (
    <SafeAreaView className="h-full bg-white">
      <ScrollView contentContainerClassName="pb-32 px-7">
        <Text className="text-2xl font-rubik-bold mb-6">AI Itinerary Test</Text>

        {/* Generate Button */}
        <TouchableOpacity
          onPress={handleGenerate}
          className="bg-primary-100 py-3 px-6 rounded"
        >
          <Text className="text-white text-center font-rubik-semibold">
            Generate New Itinerary
          </Text>
        </TouchableOpacity>

        {/* View Saved Button */}
        <TouchableOpacity
          onPress={handleViewSaved}
          className="bg-gray-200 py-3 px-6 rounded mt-4"
        >
          <Text className="text-black text-center font-rubik-semibold">
            View Saved Itinerary
          </Text>
        </TouchableOpacity>

        {/* Optimize Button */}
        <TouchableOpacity
          onPress={handleOptimize}
          className="bg-green-500 py-3 px-6 rounded mt-4"
        >
          <Text className="text-white text-center font-rubik-semibold">
            Optimize Itinerary
          </Text>
        </TouchableOpacity>

        <View className="mt-6">
          {loading && (
            <View className="items-center justify-center">
              <ActivityIndicator size="large" color="#0061ff" />
              <Text className="text-gray-500 mt-4">Processing...</Text>
            </View>
          )}

          {rawResult?.itinerary &&
            renderItinerary(rawResult, "AI Generated Itinerary")}
          {optimizedResult?.itinerary &&
            renderItinerary(optimizedResult, "Optimized Itinerary")}

          {rawResult?.error && (
            <Text className="text-red-500 mt-4">Error: {rawResult.error}</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
