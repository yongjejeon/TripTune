// screens/Index.tsx
import CalendarRangePicker, { DateISO } from "@/lib/components/calendar";
import { fetchPlacesByCoordinates } from "@/lib/google";
import { inferPreferencesFromSelections } from "@/lib/preferences";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert, Image, Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const PERF = true;
const t = (label: string) => PERF && console.time(label);
const tend = (label: string) => PERF && console.timeEnd(label);

export default function Index() {
  const [city, setCity] = useState("");
  const [places, setPlaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Onboarding - now integrated into main UI
  const [onboardStep, setOnboardStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  //trip dates
  const [startDate, setStartDate] = useState<DateISO>("");
  const [endDate, setEndDate] = useState<DateISO>("");

  // Step 1 metrics
  const [age, setAge] = useState<string>("");
  const [height, setHeight] = useState<string>("");
  const [weight, setWeight] = useState<string>("");
  const [gender, setGender] = useState<string>("");
  const [detecting, setDetecting] = useState(false);

  // Step 3 selection grid
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ------- Helpers -------
  const buildPreferenceCandidates = (source: any[], maxPerCat = 8, cap = 50) => {
    if (!Array.isArray(source) || !source.length) return [];
    
    // Prioritize places with photos and good ratings
    const scored = [...source]
      .map((p) => ({
        ...p,
        _prefScore:
          (p.photoUrl ? 2 : 0) +  // Photos are very important
          (p.rating > 4 ? 2 : 0) +  // High ratings are important
          (p.rating > 3 ? 1 : 0) +  // Decent ratings get some points
          (p.user_ratings_total > 100 ? 1 : 0) +  // Popular places
          (p.user_ratings_total > 10 ? 1 : 0),  // At least some reviews
      }))
      .sort((a, b) => b._prefScore - a._prefScore);

    console.log(`🎯 Building candidates from ${source.length} places (maxPerCat: ${maxPerCat}, cap: ${cap})`);

    const byCat: Record<string, any[]> = {};
    scored.forEach((p) => {
      const cat = p.category || "attraction";
      if (!byCat[cat]) byCat[cat] = [];
      if (byCat[cat].length < maxPerCat) byCat[cat].push(p);
    });

    const picked: any[] = [];
    Object.values(byCat).forEach((list) => {
      picked.push(...list);
    });

    // If we don't have enough variety, fill with top-rated places regardless of category
    if (picked.length < cap) {
      const remaining = scored.filter(p => !picked.includes(p));
      picked.push(...remaining.slice(0, cap - picked.length));
    }

    console.log(`🎯 Built ${picked.length} candidates from ${Object.keys(byCat).length} categories`);
    console.log(`📊 Categories: ${Object.entries(byCat).map(([cat, list]) => `${cat}(${list.length})`).join(', ')}`);
    
    return picked.slice(0, cap);
  };

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function computePrefsFromSelection() {
    // Get selected places from candidates
    const selectedPlaces = Array.from(selectedIds)
      .map(id => candidates.find(c => c.place_id === id))
      .filter(Boolean);

    console.log(`🧠 Analyzing ${selectedPlaces.length} selected places for smart preference inference...`);

    // Use smart inference instead of manual weight calculation
    const preferences = inferPreferencesFromSelections(selectedPlaces);
    const mustSee = Array.from(selectedIds);

    console.log("✅ Smart preferences computed:", {
      totalSelections: selectedPlaces.length,
      categories: Object.keys(preferences).length,
      mustSeeCount: mustSee.length
    });

    return { preferences, mustSee };
  }

  async function saveSelectionAndClose() {
    try {
      // 1) Build userPreferences from the grid
      const { preferences, mustSee } = computePrefsFromSelection();
      
      // 2) Trip dates validation
      if (!startDate || !endDate) {
        Alert.alert("Trip dates needed", "Please select a start and end date.");
        setOnboardStep(2);
        return;
      }
  
      // 3) Trip context (used by multi-day planner)
      const tripContext = {
        startDate,
        endDate,
        homebase: coords,
        days: Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1,
        gender,
        accommodationAddress: city || "",
      };

      // 4) Save everything to AsyncStorage
      await AsyncStorage.setItem("userPreferences", JSON.stringify({ preferences, mustSee }));
      await AsyncStorage.setItem("tripContext", JSON.stringify(tripContext));
      await AsyncStorage.setItem("userBiometrics", JSON.stringify({ age, height, weight, gender }));

      console.log("✅ Onboarding completed and saved:", {
        preferences: Object.keys(preferences).length,
        mustSee: mustSee.length,
        tripDays: tripContext.days,
        biometrics: { age, height, weight, gender }
      });

      Alert.alert("Success!", "Your preferences have been saved. Head to the Explore tab to start planning your trip!");
      setOnboardStep(5); // Completion state
    } catch (error) {
      console.error("❌ Failed to save preferences:", error);
      Alert.alert("Error", "Failed to save preferences. Please try again.");
    }
  }

  async function detectLocation() {
    setDetecting(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Denied", "Location access is required to detect nearby places.");
        return;
      }

      t("LOC:getCurrentPosition");
      const loc = await Location.getCurrentPositionAsync({});
      tend("LOC:getCurrentPosition");

      const { latitude, longitude } = loc.coords;
      setCoords({ lat: latitude, lng: longitude });

      // Reverse geocoding to get city name
      const data = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (!data || data.length === 0) {
        Alert.alert("Error", "Could not detect city from location");
        return;
      }

      const address = data[0];
      if (address.city) {
        setCity(address.city);
      } else if (address.region) {
        setCity(address.region);
      }

      // Auto-load places when location is detected
      await loadPlaces(latitude, longitude);
    } catch (error) {
      console.error("❌ Location detection failed:", error);
      Alert.alert("Error", "Failed to detect location. Please try again.");
    } finally {
      setDetecting(false);
    }
  }

  async function loadPlaces(targetLat?: number, targetLng?: number) {
    if (!targetLat || !targetLng) {
      Alert.alert("Error", "No coordinates available. Please detect location first.");
      return;
    }

    setLoading(true);
    console.log(`🔍 Fetching POIs near: ${targetLat}, ${targetLng}`);

    try {
      t("fetchPlacesByCoordinates");
      const results = await fetchPlacesByCoordinates(targetLat, targetLng);
      tend("fetchPlacesByCoordinates");

      console.log(`📍 Found ${results.length} places`);
      console.log(`🔑 API Key status: ${process.env.EXPO_PUBLIC_GOOGLE_API_KEY ? 'Present' : 'Missing'}`);
      
      // Debug: Check how many places have photos
      const withPhotos = results.filter(p => p.photoUrl);
      console.log(`📸 Places with photos: ${withPhotos.length}/${results.length}`);
      
      // Detailed photo debugging
      console.log(`🔍 Photo debugging for first 5 places:`);
      results.slice(0, 5).forEach((p, i) => {
        console.log(`${i + 1}. ${p.name}:`, {
          hasPhotos: !!p.photos,
          photosLength: p.photos?.length || 0,
          photoRef: p.photos?.[0]?.photo_reference || 'none',
          photoUrl: p.photoUrl || 'none',
          rating: p.rating,
          user_ratings_total: p.user_ratings_total
        });
      });
      
      if (withPhotos.length > 0) {
        console.log(`📸 Sample photo URLs:`, withPhotos.slice(0, 3).map(p => ({ name: p.name, photoUrl: p.photoUrl })));
      } else {
        console.log(`❌ No places have photos! This might be a Google Places API issue.`);
        console.log(`🔧 Possible causes:`);
        console.log(`   - Google Places API key doesn't have photo permissions`);
        console.log(`   - Places don't have photos in the database`);
        console.log(`   - Photo URLs are being blocked by CORS or network issues`);
      }
      
      setPlaces(results);

      // Build candidates for selection
      const candidates = buildPreferenceCandidates(results);
      setCandidates(candidates);
      console.log(`🎯 Built ${candidates.length} preference candidates`);
      
      // Debug: Check candidates with photos
      const candidatesWithPhotos = candidates.filter(p => p.photoUrl);
      console.log(`📸 Candidates with photos: ${candidatesWithPhotos.length}/${candidates.length}`);
      
      // Test photo URL accessibility
      if (candidatesWithPhotos.length > 0) {
        const testPhoto = candidatesWithPhotos[0];
        console.log(`🧪 Testing photo URL accessibility for: ${testPhoto.name}`);
        console.log(`🧪 Photo URL: ${testPhoto.photoUrl}`);
        
        // Test if the photo URL is accessible
        fetch(testPhoto.photoUrl)
          .then(response => {
            console.log(`🧪 Photo fetch result: ${response.status} ${response.statusText}`);
            if (response.ok) {
              console.log(`✅ Photo URL is accessible!`);
            } else {
              console.log(`❌ Photo URL returned error: ${response.status}`);
            }
          })
          .catch(error => {
            console.log(`❌ Photo fetch failed:`, error.message);
          });
      }
    } catch (error) {
      console.error("❌ Failed to load places:", error);
      Alert.alert("Error", "Failed to load places. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function pullFresh() {
    if (!coords?.lat || !coords?.lng) {
      Alert.alert("Error", "No coordinates available. Please detect location first.");
      return;
    }
    setLoading(true);
    console.log("🔄 Pull Fresh from Google…");
    const results = await fetchPlacesByCoordinates(coords.lat, coords.lng, {
      bypassSeedCache: true,
    });
    setPlaces(results);
    const candidates = buildPreferenceCandidates(results);
    setCandidates(candidates);
    setLoading(false);
  }

  // Auto-load places when location is detected and we're on step 4
  useEffect(() => {
    if (coords && onboardStep === 4 && candidates.length === 0) {
      loadPlaces(coords.lat, coords.lng);
    }
  }, [coords, onboardStep]);

  // Resolve a typed city to coordinates if needed
  async function resolveCityToCoordsIfNeeded() {
    if (coords) return coords;
    if (!city || city.trim().length === 0) return null;
    try {
      const results = await Location.geocodeAsync(city);
      if (results && results.length > 0) {
        const { latitude, longitude } = results[0];
        const next = { lat: latitude, lng: longitude };
        setCoords(next);
        return next;
      }
    } catch (e) {
      console.warn("geocode failed", e);
    }
    return null;
  }

  // ------- UI -------
  return (
    <SafeAreaView className="h-full bg-white">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-32 px-7">
        
        {/* Welcome Header */}
        <View className="mt-8 mb-8">
          <Text className="text-3xl font-rubik-bold text-gray-900 mb-2">
            Welcome to TripTune
          </Text>
          <Text className="text-lg text-gray-600">
            Let's create your perfect trip experience
          </Text>
        </View>

        {/* Progress Indicator (only show during steps 1-4) */}
        {onboardStep <= 4 && (
          <View className="mb-8">
            <View className="flex-row justify-between mb-2">
              <Text className="text-sm font-rubik-medium text-gray-600">Step {onboardStep} of 4</Text>
              <Text className="text-sm text-gray-500">{Math.round((onboardStep / 4) * 100)}% Complete</Text>
            </View>
            <View className="bg-gray-200 rounded-full h-2">
              <View 
                className="bg-primary-100 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(onboardStep / 4) * 100}%` }}
              />
            </View>
          </View>
        )}

        {/* Step 1: Personal Info */}
        {onboardStep === 1 && (
          <View className="mb-8">
            <Text className="text-2xl font-rubik-bold mb-2">Tell us about you</Text>
            <Text className="text-gray-600 mb-6">
              This helps us personalize your trip recommendations and calculate your fatigue levels.
            </Text>

            <View className="space-y-4">
              <View>
                <Text className="font-rubik-semibold mb-2 text-gray-700">Age</Text>
                <TextInput
                  placeholder="25"
                  value={age}
                  onChangeText={setAge}
                  keyboardType="numeric"
                  className="border border-gray-300 rounded-xl px-4 py-4 text-lg"
                />
              </View>
              <View>
                <Text className="font-rubik-semibold mb-2 text-gray-700">Gender</Text>
                <View className="flex-row gap-3">
                  <TouchableOpacity
                    onPress={() => setGender("male")}
                    className={`flex-1 py-4 px-4 rounded-xl border-2 ${
                      gender === "male" 
                        ? "border-primary-100 bg-primary-50" 
                        : "border-gray-300 bg-white"
                    }`}
                  >
                    <Text className={`text-center font-rubik-semibold ${
                      gender === "male" ? "text-primary-100" : "text-gray-700"
                    }`}>
                      Male
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setGender("female")}
                    className={`flex-1 py-4 px-4 rounded-xl border-2 ${
                      gender === "female" 
                        ? "border-primary-100 bg-primary-50" 
                        : "border-gray-300 bg-white"
                    }`}
                  >
                    <Text className={`text-center font-rubik-semibold ${
                      gender === "female" ? "text-primary-100" : "text-gray-700"
                    }`}>
                      Female
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setGender("other")}
                    className={`flex-1 py-4 px-4 rounded-xl border-2 ${
                      gender === "other" 
                        ? "border-primary-100 bg-primary-50" 
                        : "border-gray-300 bg-white"
                    }`}
                  >
                    <Text className={`text-center font-rubik-semibold ${
                      gender === "other" ? "text-primary-100" : "text-gray-700"
                    }`}>
                      Other
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View>
                <Text className="font-rubik-semibold mb-2 text-gray-700">Height (cm)</Text>
                <TextInput
                  placeholder="170"
                  value={height}
                  onChangeText={setHeight}
                  keyboardType="numeric"
                  className="border border-gray-300 rounded-xl px-4 py-4 text-lg"
                />
              </View>
              <View>
                <Text className="font-rubik-semibold mb-2 text-gray-700">Weight (kg)</Text>
                <TextInput
                  placeholder="70"
                  value={weight}
                  onChangeText={setWeight}
                  keyboardType="numeric"
                  className="border border-gray-300 rounded-xl px-4 py-4 text-lg"
                />
              </View>
            </View>

            <TouchableOpacity
              onPress={() => {
                const a = Number(age);
                const h = Number(height);
                const w = Number(weight);
                if (!a || !h || !w || !gender) {
                  Alert.alert("Missing info", "Please fill in all fields including gender.");
                  return;
                }
                if (a < 5 || a > 100 || h < 90 || h > 230 || w < 25 || w > 250) {
                  Alert.alert("Check your inputs","Please enter realistic Age, Height (cm), and Weight (kg).");
                  return;
                }
                setOnboardStep(2);
              }}
              className="bg-primary-100 py-4 px-6 rounded-xl mt-8"
            >
              <Text className="text-white text-center font-rubik-bold text-lg">Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Step 2: Trip Dates */}
        {onboardStep === 2 && (
          <View className="mb-8">
            <Text className="text-2xl font-rubik-bold mb-2">When are you traveling?</Text>
            <Text className="text-gray-600 mb-6">
              Select your trip dates to plan the perfect multi-day itinerary.
            </Text>

            <CalendarRangePicker
              initialStart={startDate}
              initialEnd={endDate}
              onConfirm={(range) => {
                setStartDate(range.startDate);
                setEndDate(range.endDate);
              }}
            />

            <View className="flex-row gap-4 mt-8">
              <TouchableOpacity
                onPress={() => setOnboardStep(1)}
                className="flex-1 bg-gray-200 py-4 px-6 rounded-xl"
              >
                <Text className="text-gray-700 text-center font-rubik-semibold">Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (!startDate || !endDate) {
                    Alert.alert("Missing dates", "Please select both start and end dates.");
                    return;
                  }
                  setOnboardStep(3);
                }}
                className="flex-1 bg-primary-100 py-4 px-6 rounded-xl"
              >
                <Text className="text-white text-center font-rubik-bold">Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Step 3: Accommodation Location */}
        {onboardStep === 3 && (
          <View className="mb-8">
            <Text className="text-2xl font-rubik-bold mb-2">Where are you staying?</Text>
            <Text className="text-gray-600 mb-6">
              Set your accommodation location. We will plan around this home base.
            </Text>

            <View className="bg-blue-50 p-6 rounded-xl border border-blue-200 mb-6">
              <Text className="text-blue-800 font-rubik-semibold mb-2">Choose how to set your home base</Text>
              <Text className="text-blue-700 text-sm">
                Use your current GPS position or enter the city of your hotel.
              </Text>
            </View>

            {detecting ? (
              <View className="items-center py-8">
                <ActivityIndicator size="large" color="#0061ff" />
                <Text className="text-gray-600 mt-4">Detecting your location...</Text>
              </View>
            ) : null}

            {/* Option A: Use current location */}
            <TouchableOpacity
              onPress={detectLocation}
              className="bg-primary-100 py-4 px-6 rounded-xl mb-4"
            >
              <Text className="text-white text-center font-rubik-bold text-lg">Use My Current Location</Text>
            </TouchableOpacity>

            {coords && (
              <View className="bg-green-50 p-4 rounded-xl border border-green-200 mb-6">
                <Text className="text-green-800 font-rubik-semibold">Location Set</Text>
                <Text className="text-green-700 text-sm mt-1">
                  Coordinates saved. You can also enter a city below to override.
                </Text>
              </View>
            )}

            {/* Option B: Enter city manually */}
            <View className="mb-6">
              <Text className="font-rubik-semibold mb-2 text-gray-700">Enter city (hotel)</Text>
              <TextInput
                placeholder="e.g., Abu Dhabi"
                value={city}
                onChangeText={setCity}
                className="border border-gray-300 rounded-xl px-4 py-4 text-lg"
              />
              <Text className="text-xs text-gray-500 mt-2">We’ll use this as your home base.</Text>
            </View>

            <View className="flex-row gap-4">
              <TouchableOpacity
                onPress={() => setOnboardStep(2)}
                className="flex-1 bg-gray-200 py-4 px-6 rounded-xl"
              >
                <Text className="text-gray-700 text-center font-rubik-semibold">Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  let useCoords = coords;
                  if (!useCoords && city.trim().length > 0) {
                    useCoords = await resolveCityToCoordsIfNeeded();
                  }
                  if (!useCoords) {
                    Alert.alert("Location Required", "Please use current location or enter your city to continue.");
                    return;
                  }
                  setOnboardStep(4);
                }}
                className="flex-1 bg-primary-100 py-4 px-6 rounded-xl"
              >
                <Text className="text-white text-center font-rubik-bold">Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Step 4: Place Selection */}
        {onboardStep === 4 && (
          <View className="mb-8">
            <Text className="text-2xl font-rubik-bold mb-2">What looks exciting?</Text>
            <Text className="text-gray-600 mb-6">
              Select at least 3 places that interest you. We'll use this to personalize your entire trip!
            </Text>
            
            {/* Selection Progress */}
            <View className="bg-gray-50 p-4 rounded-xl mb-6 border border-gray-200">
              <View className="flex-row justify-between items-center mb-2">
                <Text className="text-gray-700 font-rubik-semibold">Places Selected</Text>
                <Text className={`font-rubik-bold text-lg ${selectedIds.size >= 3 ? 'text-green-600' : 'text-orange-600'}`}>
                  {selectedIds.size}/3+
                </Text>
              </View>
              <View className="bg-gray-200 rounded-full h-2">
                <View 
                  className={`h-2 rounded-full ${selectedIds.size >= 3 ? 'bg-green-500' : 'bg-orange-500'}`}
                  style={{ width: `${Math.min(100, (selectedIds.size / 3) * 100)}%` }}
                />
              </View>
              <Text className="text-gray-600 text-sm mt-2">
                {selectedIds.size >= 3 
                  ? "✅ Ready to create your trip!" 
                  : `Select ${3 - selectedIds.size} more place${3 - selectedIds.size === 1 ? '' : 's'}`
                }
              </Text>
            </View>

            {loading ? (
              <View className="items-center py-12">
                <ActivityIndicator size="large" color="#0061ff" />
                <Text className="text-gray-600 mt-4">Finding amazing places near you...</Text>
              </View>
            ) : (
              <View className="mb-6">
                <Text className="text-sm text-gray-600 mb-4">
                  Showing {candidates.length} amazing places near you
                </Text>
                <View className="flex-row flex-wrap justify-between gap-2">
                  {candidates.map((p) => {
                    const selected = selectedIds.has(p.place_id);
                    return (
                      <Pressable
                        key={p.place_id}
                        onPress={() => toggleSelect(p.place_id)}
                        style={{
                          width: "48%",
                          marginBottom: 12,
                          borderRadius: 16,
                          overflow: "hidden",
                          borderWidth: selected ? 3 : 1,
                          borderColor: selected ? "#0061ff" : "#e5e7eb",
                          shadowColor: selected ? "#0061ff" : "#000",
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: selected ? 0.3 : 0.1,
                          shadowRadius: 4,
                          elevation: selected ? 6 : 2,
                        }}
                      >
                      {p.photoUrl ? (
                        <Image
                          source={{ uri: p.photoUrl }}
                          style={{ width: '100%', height: 128 }}
                          resizeMode="cover"
                          onError={(error) => {
                            console.log(`❌ Image failed to load for ${p.name}:`, error);
                            console.log(`❌ Photo URL: ${p.photoUrl}`);
                          }}
                          onLoad={() => console.log(`✅ Image loaded successfully for ${p.name}`)}
                          onLoadStart={() => console.log(`🔄 Starting to load image for ${p.name}`)}
                          onLoadEnd={() => console.log(`🏁 Finished loading image for ${p.name}`)}
                        />
                      ) : (
                        <View className="w-full h-32 bg-blue-100 items-center justify-center">
                          <Text className="text-gray-600 text-2xl mb-1">🏛️</Text>
                          <Text className="text-gray-500 text-xs font-rubik-medium">No Image</Text>
                        </View>
                      )}
                      <View className="p-3 bg-white">
                        <Text className="font-rubik-semibold text-sm mb-1" numberOfLines={2}>
                          {p.name}
                        </Text>
                        <Text className="text-gray-600 text-xs" numberOfLines={1}>
                          {p.vicinity}
                        </Text>
                        <View className="flex-row items-center mt-1">
                          <Text className="text-yellow-500 text-xs">⭐</Text>
                          <Text className="text-gray-600 text-xs ml-1">
                            {p.rating?.toFixed(1) || "N/A"}
                          </Text>
                        </View>
                      </View>
                      {selected && (
                        <View className="absolute top-2 right-2 bg-primary-100 rounded-full w-6 h-6 items-center justify-center">
                          <Text className="text-white text-xs font-rubik-bold">✓</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
                </View>
                
                {/* Load More Places Button */}
                {candidates.length < places.length && (
                  <TouchableOpacity
                    onPress={() => {
                      // Increase the cap to show more places
                      const moreCandidates = buildPreferenceCandidates(places, 12, 80);
                      setCandidates(moreCandidates);
                    }}
                    className="mt-4 py-3 px-4 bg-gray-100 rounded-xl border border-gray-300"
                  >
                    <Text className="text-gray-700 text-center font-rubik-medium">
                      🔄 Load More Places ({places.length - candidates.length} more available)
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <View className="flex-row gap-4">
              <TouchableOpacity
                onPress={() => setOnboardStep(3)}
                className="flex-1 bg-gray-200 py-4 px-6 rounded-xl"
              >
                <Text className="text-gray-700 text-center font-rubik-semibold">Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (selectedIds.size < 3) {
                    Alert.alert("Almost there", "Please select at least 3 places.");
                    return;
                  }
                  saveSelectionAndClose();
                }}
                className={`flex-1 py-4 px-6 rounded-xl ${selectedIds.size >= 3 ? "bg-primary-100" : "bg-gray-300"}`}
                disabled={selectedIds.size < 3}
                style={selectedIds.size >= 3 ? {
                  shadowColor: '#0061ff',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: 8,
                } : {}}
              >
                <Text className={`text-center font-rubik-bold text-lg ${selectedIds.size >= 3 ? 'text-white' : 'text-gray-500'}`}>
                  {selectedIds.size >= 3 ? "🚀 Create My Trip!" : `Select ${3 - selectedIds.size} more`}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Smart Analysis Preview */}
            {selectedIds.size >= 3 && (
              <TouchableOpacity
                onPress={() => {
                  const selectedPlaces = Array.from(selectedIds)
                    .map(id => candidates.find(c => c.place_id === id))
                    .filter(Boolean);
                  const preferences = inferPreferencesFromSelections(selectedPlaces);
                  const topCategories = Object.entries(preferences)
                    .sort(([,a], [,b]) => b.weight - a.weight)
                    .slice(0, 3);
                  
                  const analysis = topCategories
                    .map(([category, pref]) => `${category.replace('_', ' ')} (${pref.weight}/10)`)
                    .join(', ');
                  
                  Alert.alert(
                    "🧠 Smart Analysis", 
                    `Based on your ${selectedIds.size} selections:\n\n${analysis}\n\nWe'll recommend similar places for your trip!`
                  );
                }}
                className="mt-4 py-3 px-4 bg-blue-50 rounded-xl border border-blue-200"
              >
                <Text className="text-blue-700 text-center font-rubik-medium">
                  🧠 View Smart Analysis
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Completion State */}
        {onboardStep > 4 && (
          <View className="items-center py-12">
            <Text className="text-2xl font-rubik-bold text-green-600 mb-4">🎉 All Set!</Text>
            <Text className="text-gray-600 text-center mb-6">
              Your preferences have been saved. Head to the Explore tab to start planning your trip!
            </Text>
            <TouchableOpacity
              onPress={() => setOnboardStep(1)}
              className="bg-primary-100 py-3 px-6 rounded-xl"
            >
              <Text className="text-white font-rubik-semibold">Start Over</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fab: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
});