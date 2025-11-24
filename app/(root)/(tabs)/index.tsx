// screens/Index.tsx
import CalendarRangePicker, { DateISO } from "@/lib/components/calendar";
import LocationMapPicker from "@/lib/components/LocationMapPicker";
import { fetchPlacesByCoordinates, FetchProgressUpdate } from "@/lib/google";
import { inferPreferencesFromSelections } from "@/lib/preferences";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import DateTimePickerModal from "react-native-modal-datetime-picker";
import { SafeAreaView } from "react-native-safe-area-context";

const PERF = true;
const t = (label: string) => PERF && console.time(label);
const tend = (label: string) => PERF && console.timeEnd(label);

const formatGeocodedAddress = (address: Location.LocationGeocodedAddress | undefined | null) => {
  if (!address) return "";
  const streetLine = [address.name, address.streetNumber, address.street]
    .filter(Boolean)
    .join(" ")
    .trim();

  const locality = address.city || address.subregion || address.district || address.region;
  const country = address.country;

  const parts = [streetLine, locality, country]
    .map((part) => (part || "").trim())
    .filter((part, index, arr) => part.length > 0 && arr.indexOf(part) === index);

  return parts.join(", ") || locality || streetLine || country || "";
};

const formatDateLabel = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const parseTimeToDate = (time: string) => {
  const [hours, minutes] = time.split(":").map((part) => parseInt(part, 10));
  const now = new Date();
  now.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return now;
};

const formatTimeFromDate = (date: Date) => {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

export default function Index() {
  const router = useRouter();
  const [city, setCity] = useState("");
  const [places, setPlaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [mapRefining, setMapRefining] = useState(false);
  const [manualLookupLoading, setManualLookupLoading] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const placesApiKey = process.env.EXPO_PUBLIC_GOOGLE_API_KEY ?? "";

  const [itineraryStart, setItineraryStart] = useState<string>("09:00");

  const [loadingProgress, setLoadingProgress] = useState<{ value: number; label: string }>({
    value: 0,
    label: "",
  });

  const [savedSelectionSummary, setSavedSelectionSummary] = useState<Array<{ place_id: string; name: string }>>([]);
  const [savingPreferences, setSavingPreferences] = useState(false);

  const activeRequestRef = useRef<string | null>(null);
  const lastCompletedRequestRef = useRef<string | null>(null);

  const buildRequestSignature = (
    lat: number,
    lng: number,
    cityHint?: string,
    tripStart?: DateISO,
    tripEnd?: DateISO
  ) => {
    const latKey = lat?.toFixed?.(4) ?? String(lat);
    const lngKey = lng?.toFixed?.(4) ?? String(lng);
    return [latKey, lngKey, cityHint ?? "", tripStart ?? "", tripEnd ?? ""].join("|");
  };

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

    console.log(`Building candidates from ${source.length} places (maxPerCat: ${maxPerCat}, cap: ${cap})`);

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

    console.log(`Built ${picked.length} candidates from ${Object.keys(byCat).length} categories`);
    console.log(`Categories: ${Object.entries(byCat).map(([cat, list]) => `${cat}(${list.length})`).join(', ')}`);
    
    return picked.slice(0, cap);
  };

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const normalizedLoadingProgress = (() => {
    const value = loadingProgress?.value ?? 0;
    if (Number.isNaN(value)) return 0;
    return Math.min(1, Math.max(0, value));
  })();

  const estimatedMinutesRemaining = loading
    ? Math.max(1, Math.ceil((1 - normalizedLoadingProgress) * 5))
    : null;

  useEffect(() => {
    if (onboardStep !== 4) return;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("userPreferences");
        if (!raw) {
          setSavedSelectionSummary([]);
          setSelectedIds(new Set());
          return;
        }

        const parsed = JSON.parse(raw);
        const mustSeeIds: string[] = Array.isArray(parsed?.mustSee)
          ? parsed.mustSee.filter((id: any) => typeof id === "string")
          : [];
        const storedPlaces: Array<{ place_id: string; name: string }> = Array.isArray(parsed?.selectedPlaces)
          ? parsed.selectedPlaces.filter(
              (entry: any) => entry && typeof entry.place_id === "string" && typeof entry.name === "string"
            )
          : mustSeeIds.map((id) => ({ place_id: id, name: id }));

        setSavedSelectionSummary(storedPlaces);
        setSelectedIds(new Set(mustSeeIds));
      } catch (error) {
        console.warn("Failed to load saved preferences", error);
      }
    })();
  }, [onboardStep]);

  const selectedSummaryList = useMemo(() => {
    const ids = Array.from(selectedIds);
    if (!ids.length) {
      return savedSelectionSummary;
    }

    const mergedPool = [...candidates, ...places];
    const lookup = new Map<string, any>(mergedPool.map((p: any) => [p.place_id, p]));
    return ids.map((id) => {
      const place = lookup.get(id);
      const fallback = savedSelectionSummary.find((item) => item.place_id === id);
      return {
        place_id: id,
        name: place?.name ?? fallback?.name ?? "Selected place",
      };
    });
  }, [selectedIds, candidates, places, savedSelectionSummary]);

  function computePrefsFromSelection() {
    // Get selected places from candidates
    const selectedPlaces = Array.from(selectedIds)
      .map(id => candidates.find(c => c.place_id === id))
      .filter(Boolean);

    console.log(`Analyzing ${selectedPlaces.length} selected places for smart preference inference...`);

    // Use smart inference instead of manual weight calculation
    const preferences = inferPreferencesFromSelections(selectedPlaces);
    const mustSee = Array.from(selectedIds);

    console.log("Smart preferences computed:", {
      totalSelections: selectedPlaces.length,
      categories: Object.keys(preferences).length,
      mustSeeCount: mustSee.length
    });

    return { preferences, mustSee };
  }

  const handleResetPreferences = () => {
    Alert.alert(
      "Reset preferences?",
      "This will clear your saved selections and itinerary plan.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            try {
              await AsyncStorage.removeItem("userPreferences");
              await AsyncStorage.removeItem("savedTripPlan");
              await AsyncStorage.removeItem("pendingAutoGenerateTripPlan");
              setSelectedIds(new Set());
              setSavedSelectionSummary([]);
              Alert.alert("Preferences reset", "Selections cleared. You can choose new places now.");
            } catch (error) {
              console.error("Failed to reset preferences:", error);
              Alert.alert("Error", "Couldn't reset preferences. Please try again.");
            }
          },
        },
      ]
    );
  };

  async function saveSelectionAndClose() {
    if (savingPreferences) return;
    try {
      setSavingPreferences(true);

      // 1) Build userPreferences from the grid
      const { preferences, mustSee } = computePrefsFromSelection();
      
      // 2) Trip dates validation
      if (!startDate || !endDate) {
        Alert.alert("Trip dates needed", "Please select a start and end date.");
        setOnboardStep(2);
        setSavingPreferences(false);
        return;
      }

      const pool = [...candidates, ...places];
      const lookup = new Map<string, any>(pool.map((p: any) => [p.place_id, p]));
      const selectedSummaries = Array.from(new Set(mustSee)).map((id) => {
        const place = lookup.get(id);
        const fallback = savedSelectionSummary.find((item) => item.place_id === id);
        return {
          place_id: id,
          name: place?.name ?? fallback?.name ?? "Selected place",
        };
      });

      // 3) Trip context (used by multi-day planner)
      const tripContext = {
        startDate,
        endDate,
        homebase: coords,
        days: Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1,
        gender,
        accommodationAddress: city || "",
        itineraryStartTime: itineraryStart,
      };

      // 4) Save everything to AsyncStorage
      await AsyncStorage.setItem(
        "userPreferences",
        JSON.stringify({ preferences, mustSee, selectedPlaces: selectedSummaries })
      );
      await AsyncStorage.setItem("tripContext", JSON.stringify(tripContext));
      await AsyncStorage.setItem("userBiometrics", JSON.stringify({ age, height, weight, gender }));
      await AsyncStorage.setItem("pendingAutoGenerateTripPlan", "1");

      console.log("Onboarding completed and saved:", {
        preferences: Object.keys(preferences).length,
        mustSee: mustSee.length,
        tripDays: tripContext.days,
        biometrics: { age, height, weight, gender }
      });

      setSavedSelectionSummary(selectedSummaries);

      Alert.alert("Preferences saved", "Sit tight, we're building your multi-day itinerary now!");
      router.replace("/(root)/(tabs)/explore");
    } catch (error) {
      console.error("Failed to save preferences:", error);
      Alert.alert("Error", "Failed to save preferences. Please try again.");
    } finally {
      setSavingPreferences(false);
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
      const formatted = formatGeocodedAddress(address);
      if (formatted) {
        setCity(formatted);
      } else if (address?.city) {
        setCity(address.city);
      } else if (address?.region) {
        setCity(address.region);
      }

      // Auto-load places when location is detected
      await loadPlaces(latitude, longitude, address.city ?? address.region ?? undefined, startDate, endDate);
    } catch (error) {
      console.error("Location detection failed:", error);
      Alert.alert("Error", "Failed to detect location. Please try again.");
    } finally {
      setDetecting(false);
    }
  }

  async function loadPlaces(
    targetLat?: number,
    targetLng?: number,
    cityHint?: string,
    tripStart?: DateISO,
    tripEnd?: DateISO,
    options?: { force?: boolean }
  ) {
    if (!targetLat || !targetLng) {
      Alert.alert("Error", "No coordinates available. Please detect location first.");
      return;
    }

    const normalizedCity = cityHint || city || "";
    const normalizedStart = tripStart || startDate || "";
    const normalizedEnd = tripEnd || endDate || "";
    const requestSignature = buildRequestSignature(
      targetLat,
      targetLng,
      normalizedCity,
      normalizedStart,
      normalizedEnd
    );

    if (activeRequestRef.current === requestSignature) {
      console.log("ai-shortlist: skipping duplicate in-flight request", requestSignature);
      return;
    }

    if (!options?.force && lastCompletedRequestRef.current === requestSignature) {
      console.log("ai-shortlist: skipping duplicate request", requestSignature);
      return;
    }

    activeRequestRef.current = requestSignature;

    setLoading(true);
    setLoadingProgress({ value: 0.05, label: "Preparing nearby places..." });
    console.log(`Fetching POIs near: ${targetLat}, ${targetLng}`);

    try {
      t("fetchPlacesByCoordinates");
      const results = await fetchPlacesByCoordinates(targetLat, targetLng, {
        cityName: cityHint || city || undefined,
        tripWindow: {
          start: tripStart || startDate || undefined,
          end: tripEnd || endDate || undefined,
        },
        onProgress: (update: FetchProgressUpdate) => {
          setLoadingProgress((prev) => ({
            value:
              update.progress !== undefined
                ? Math.max(0, Math.min(1, update.progress))
                : prev.value,
            label: update.message ?? prev.label,
          }));
        },
      });
      tend("fetchPlacesByCoordinates");

      console.log(`Found ${results.length} places`);
      console.log(`API Key status: ${process.env.EXPO_PUBLIC_GOOGLE_API_KEY ? 'Present' : 'Missing'}`);
      
      // Debug: Check how many places have photos
      const withPhotos = results.filter(p => p.photoUrl);
      console.log(`Places with photos: ${withPhotos.length}/${results.length}`);
      
      // Detailed photo debugging
      console.log(`Photo debugging for first 5 places:`);
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
        console.log(`Sample photo URLs:`, withPhotos.slice(0, 3).map(p => ({ name: p.name, photoUrl: p.photoUrl })));
      } else {
        console.log(`No places have photos. This might be a Google Places API issue.`);
        console.log(`Possible causes:`);
        console.log(`   - Google Places API key doesn't have photo permissions`);
        console.log(`   - Places don't have photos in the database`);
        console.log(`   - Photo URLs are being blocked by CORS or network issues`);
      }
      
      setPlaces(results);
      setLoadingProgress({ value: 1, label: "Recommendations ready!" });

      // Save places to AsyncStorage for reuse in planMultiDayTrip (avoids duplicate fetching)
      try {
        await AsyncStorage.setItem("cachedPlaces", JSON.stringify(results));
        console.log(`Saved ${results.length} places to cache for reuse`);
      } catch (error) {
        console.warn("Failed to cache places:", error);
      }

      // Build candidates for selection
      const candidates = buildPreferenceCandidates(results);
      setCandidates(candidates);
      console.log(`Built ${candidates.length} preference candidates`);
      
      // Debug: Check candidates with photos
      const candidatesWithPhotos = candidates.filter(p => p.photoUrl);
      console.log(`Candidates with photos: ${candidatesWithPhotos.length}/${candidates.length}`);
      
      // Test photo URL accessibility
      if (candidatesWithPhotos.length > 0) {
        const testPhoto = candidatesWithPhotos[0];
        console.log(`Testing photo URL accessibility for: ${testPhoto.name}`);
        console.log(`Photo URL: ${testPhoto.photoUrl}`);
        
        // Test if the photo URL is accessible
        fetch(testPhoto.photoUrl)
          .then(response => {
            console.log(`Photo fetch result: ${response.status} ${response.statusText}`);
            if (response.ok) {
              console.log(`Photo URL is accessible.`);
            } else {
              console.log(`Photo URL returned error: ${response.status}`);
            }
          })
          .catch(error => {
            console.log(`Photo fetch failed:`, error.message);
          });
      }
      lastCompletedRequestRef.current = requestSignature;
      return results;
    } catch (error) {
      console.error("Failed to load places:", error);
      Alert.alert("Error", "Failed to load places. Please try again.");
    } finally {
      setLoading(false);
      if (activeRequestRef.current === requestSignature) {
        activeRequestRef.current = null;
      }
      setTimeout(() => {
        setLoadingProgress({ value: 0, label: "" });
      }, 500);
    }
  }

  async function pullFresh() {
    if (!coords?.lat || !coords?.lng) {
      Alert.alert("Error", "No coordinates available. Please detect location first.");
      return;
    }
    console.log("Pulling fresh data from Google.");
    await loadPlaces(
      coords.lat,
      coords.lng,
      city,
      startDate,
      endDate,
      { force: true }
    );
  }

  // Auto-load places when location is detected and we're on step 4
  // REMOVED: This useEffect was causing duplicate calls. loadPlaces is already called in handleLocationDetected.
  // useEffect(() => {
  //   if (coords && onboardStep === 4 && candidates.length === 0) {
  //     loadPlaces(coords.lat, coords.lng, city, startDate, endDate);
  //   }
  // }, [coords, onboardStep]);

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
        try {
          const reverse = await Location.reverseGeocodeAsync({ latitude, longitude });
          const formatted = formatGeocodedAddress(reverse?.[0]);
          if (formatted) {
            setCity(formatted);
          }
        } catch (error) {
          console.warn("Reverse geocode failed while resolving", error);
        }
        return next;
      }
    } catch (e) {
      console.warn("geocode failed", e);
    }
    return null;
  }

  const handleMapCoordinateChange = useCallback(async (next: { lat: number; lng: number }) => {
    if (!next) return;
    const hasExisting = coords ? Math.abs(coords.lat - next.lat) < 0.00001 && Math.abs(coords.lng - next.lng) < 0.00001 : false;
    setCoords(next);
    if (hasExisting) {
      return;
    }
    setMapRefining(true);
    try {
      const result = await Location.reverseGeocodeAsync({ latitude: next.lat, longitude: next.lng });
      const address = result?.[0];
      const formatted = formatGeocodedAddress(address);
      if (formatted) {
        setCity(formatted);
      }
    } catch (error) {
      console.warn("Map selection reverse geocode failed", error);
    } finally {
      setMapRefining(false);
    }
  }, [coords, setCity]);

  const handleManualAddressLookup = useCallback(async () => {
    const input = (city || "").trim();
    if (!input) {
      Alert.alert("Enter address", "Please type a city or hotel address first.");
      return;
    }

    setManualLookupLoading(true);
    try {
      const geocodeResults = await Location.geocodeAsync(input);
      if (!geocodeResults || !geocodeResults.length) {
        Alert.alert("Address not found", "We couldn't locate that address. Try refining your search or use the map.");
        return;
      }

      const { latitude, longitude } = geocodeResults[0];
      const next = { lat: latitude, lng: longitude };
      setCoords(next);

      const reverse = await Location.reverseGeocodeAsync({ latitude, longitude });
      const formatted = formatGeocodedAddress(reverse?.[0]);
      if (formatted) {
        setCity(formatted);
      }
    } catch (error) {
      console.error("Manual location lookup failed", error);
      Alert.alert("Lookup failed", "Something went wrong while finding that address. Please try again.");
    } finally {
      setManualLookupLoading(false);
    }
  }, [city]);

  // ------- UI -------
  return (
    <SafeAreaView className="h-full bg-white">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-32 px-7">
        
        {/* Welcome Header */}
        <View className="mt-8 mb-8 items-center">
          <Text className="text-3xl font-rubik-bold text-gray-900 mb-2">
            Welcome to TripTune
          </Text>
          <Text className="text-lg text-gray-600 text-center">
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
 

            <CalendarRangePicker
              initialStart={startDate}
              initialEnd={endDate}
              onConfirm={(range) => {
                setStartDate(range.startDate);
                setEndDate(range.endDate);
                setShowTimePicker(true);
              }}
            />

            {startDate || endDate ? (
              <View className="mt-4 border border-gray-200 rounded-xl px-4 py-3 bg-white">
                <Text className="text-sm font-rubik-medium text-gray-900">
                  Start: {startDate ? formatDateLabel(startDate) : "—"}
                </Text>
                <Text className="text-sm font-rubik-medium text-gray-900 mt-2">
                  End: {endDate ? formatDateLabel(endDate) : "—"}
                </Text>
              </View>
            ) : null}

            {startDate && endDate ? (
              <View className="mt-6 border border-primary-100 bg-primary-50/40 rounded-2xl p-5 items-center">
                <Text className="font-rubik-semibold text-primary-900 mb-2">Selected dates</Text>
                <Text className="text-primary-900 text-sm font-rubik-medium text-center">
                  {formatDateLabel(startDate)} → {formatDateLabel(endDate)}
                </Text>
                <TouchableOpacity
                  onPress={() => setShowTimePicker(true)}
                  className="mt-4 px-5 py-2 rounded-full border border-primary-100"
                >
                  <Text className="text-primary-100 font-rubik-semibold text-sm">
                    Adjust start time ({itineraryStart})
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <DateTimePickerModal
              isVisible={showTimePicker}
              mode="time"
              date={parseTimeToDate(itineraryStart)}
              minuteInterval={1}
              onConfirm={(date) => {
                const formatted = formatTimeFromDate(date);
                setItineraryStart(formatted);
                setShowTimePicker(false);
              }}
              onCancel={() => setShowTimePicker(false)}
            />

            <View className="mt-8 flex-row gap-4">
              <TouchableOpacity
                onPress={() => setOnboardStep(1)}
                className="flex-1 bg-gray-200 py-4 px-6 rounded-xl"
              >
                <Text className="text-gray-700 text-center font-rubik-semibold">Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (!startDate || !endDate) {
                    Alert.alert("Select dates", "Please choose a start and end date before continuing.");
                    return;
                  }
                  setOnboardStep(3);
                }}
                className={`flex-1 py-4 px-6 rounded-xl ${startDate && endDate ? "bg-primary-100" : "bg-gray-300"}`}
                disabled={!startDate || !endDate}
              >
                <Text className={`text-center font-rubik-bold text-lg ${startDate && endDate ? "text-white" : "text-gray-500"}`}>
                  Confirm
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Step 3: Accommodation Location */}
        {onboardStep === 3 && (
          <View className="mb-8">
            <Text className="text-2xl font-rubik-bold mb-2 text-center">Where are you staying?</Text>
            <Text className="text-gray-600 mb-6 text-center">
              Set your accommodation location. We will plan around this home base.
            </Text>
 
            {detecting ? (
              <View className="items-center py-8">
                <View className="h-3 bg-gray-200 rounded-full overflow-hidden">
                    <View
                      className="h-3 bg-primary-100 rounded-full"
                      style={{ width: `${Math.max(8, Math.round((loadingProgress.value || 0) * 100))}%` }}
                    />
                  </View>
                <Text className="text-gray-600 mt-4">Detecting your location...</Text>
              </View>
            ) : null}
 
            {placesApiKey ? (
              <View className="mb-4">
                <Text className="font-rubik-semibold text-gray-700 mb-2">Search hotel or address</Text>
              </View>
            ) : null}
 
            {/* Option A: Use current location */}
            <TouchableOpacity
              onPress={detectLocation}
              className="bg-primary-100 py-4 px-6 rounded-xl mb-4"
            >
              <Text className="text-white text-center font-rubik-bold text-lg">Use My Current Location</Text>
            </TouchableOpacity>
 
            <View className="mb-6">
              <Text className="font-rubik-semibold text-gray-700 mb-3">Fine-tune on the map</Text>
              <LocationMapPicker value={coords} onChange={handleMapCoordinateChange} />
              <View className="flex-row justify-between items-center mt-3">
                <Text className="text-xs text-gray-500">Tap to drop a pin or drag the marker to your hotel.</Text>
                {coords && (
                  <Text className="text-xs font-rubik-semibold text-gray-600">
                    {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                  </Text>
                )}
              </View>
              {mapRefining && (
                <Text className="text-xs text-gray-500 mt-2">Updating nearby address...</Text>
              )}
            </View>

            {city ? (
              <View className="mb-6 border border-primary-100 rounded-xl p-4 bg-primary-50/40">
                <Text className="text-primary-900 font-rubik-semibold mb-1">Selected home base</Text>
                <Text className="text-primary-900 text-sm" numberOfLines={3}>
                  {city}
                </Text>
              </View>
            ) : null}
 
            {/* Option B: Enter city manually */}
            <View className="mb-6">
              <Text className="font-rubik-semibold mb-2 text-gray-700">Enter city (hotel)</Text>
              <TextInput
                placeholder="e.g., Abu Dhabi"
                value={city}
                onChangeText={setCity}
                className="border border-gray-300 rounded-xl px-4 py-4 text-lg"
              />
              <Text className="text-xs text-gray-500 mt-2">We'll use this as your home base.</Text>
              <TouchableOpacity
                onPress={handleManualAddressLookup}
                disabled={manualLookupLoading}
                className="mt-3 py-3 px-4 rounded-xl border border-gray-300 bg-white"
              >
                {manualLookupLoading ? (
                  <View className="flex-row items-center justify-center gap-2">
                    <ActivityIndicator size="small" color="#0061ff" />
                    <Text className="text-gray-700 font-rubik-medium">Looking up address...</Text>
                  </View>
                ) : (
                  <Text className="text-center font-rubik-semibold text-gray-700">Find this address</Text>
                )}
              </TouchableOpacity>
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
                className={`flex-1 py-4 px-6 rounded-xl ${coords ? "bg-primary-100" : "bg-gray-300"}`}
                disabled={!coords}
              >
                <Text className={`text-center font-rubik-bold ${coords ? "text-white" : "text-gray-500"}`}>
                  Continue
                </Text>
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
                  ? "Ready to create your trip!" 
                  : `Select ${3 - selectedIds.size} more place${3 - selectedIds.size === 1 ? '' : 's'}`
                }
              </Text>
            </View>

            {selectedSummaryList.length > 0 && (
              <View className="bg-primary-50 border border-primary-100 rounded-2xl p-4 mb-6">
                <Text className="text-primary-900 font-rubik-semibold mb-2">Your selected places</Text>
                <View className="flex-row flex-wrap gap-2">
                  {selectedSummaryList.map((item) => (
                    <View key={item.place_id} className="bg-white/80 border border-primary-200 px-3 py-1.5 rounded-full">
                      <Text className="text-primary-700 text-xs font-rubik-semibold" numberOfLines={1}>
                        {item.name}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {loading ? (
              <View className="items-center py-10 px-6 bg-gray-50 rounded-2xl border border-gray-200">
                <Text className="text-lg font-rubik-semibold text-gray-800 mb-3">Curating your shortlist...</Text>
                <ActivityIndicator size="large" color="#0061ff" />
                <View style={{ width: "100%" }}>
                  <View className="h-3 bg-gray-200 rounded-full overflow-hidden">
                    <View
                      className="h-3 bg-primary-100 rounded-full"
                      style={{ width: `${Math.max(8, Math.round((loadingProgress.value || 0) * 100))}%` }}
                    />
                  </View>
                </View>
                <Text className="text-gray-600 mt-3 text-center">
                  {loadingProgress.label || "Finding amazing places near you..."}
                </Text>
                {typeof estimatedMinutesRemaining === "number" && (
                  <Text className="text-gray-500 text-sm mt-2 text-center">
                    Estimated time remaining: about {estimatedMinutesRemaining} minute{estimatedMinutesRemaining === 1 ? "" : "s"}
                  </Text>
                )}
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
                            console.log(`Image failed to load for ${p.name}:`, error);
                            console.log(`Photo URL: ${p.photoUrl}`);
                          }}
                          onLoad={() => console.log(`Image loaded successfully for ${p.name}`)}
                          onLoadStart={() => console.log(`Starting to load image for ${p.name}`)}
                          onLoadEnd={() => console.log(`Finished loading image for ${p.name}`)}
                        />
                      ) : (
                        <View className="w-full h-32 bg-blue-100 items-center justify-center">
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
                        <Text className="text-gray-600 text-xs mt-1">
                          Rating: {p.rating?.toFixed(1) || "N/A"}
                        </Text>
                      </View>
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
                      Load More Places ({places.length - candidates.length} more available)
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
            </View>

            <View className="flex-row gap-4 mt-4">
              <TouchableOpacity
                onPress={handleResetPreferences}
                className="flex-1 border-2 border-gray-300 py-4 px-6 rounded-xl"
              >
                <Text className="text-center font-rubik-semibold text-gray-700">Reset Preferences</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (selectedIds.size < 3) {
                    Alert.alert("Almost there", "Please select at least 3 places.");
                    return;
                  }
                  saveSelectionAndClose();
                }}
                className={`flex-1 py-4 px-6 rounded-xl ${(selectedIds.size >= 3 && !savingPreferences) ? "bg-primary-100" : "bg-gray-300"}`}
                disabled={selectedIds.size < 3 || savingPreferences}
                style={selectedIds.size >= 3 && !savingPreferences ? {
                  shadowColor: '#0061ff',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: 8,
                } : {}}
              >
                <Text className={`text-center font-rubik-bold text-lg ${(selectedIds.size >= 3 && !savingPreferences) ? 'text-white' : 'text-gray-500'}`}>
                  {savingPreferences ? "Saving..." : (selectedIds.size >= 3 ? "Confirm and Plan Trip" : `Select ${3 - selectedIds.size} more`)}
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
                    "Smart Analysis", 
                    `Based on your ${selectedIds.size} selections:\n\n${analysis}\n\nWe'll recommend similar places for your trip!`
                  );
                }}
                className="mt-4 py-3 px-4 bg-blue-50 rounded-xl border border-blue-200"
              >
                <Text className="text-blue-700 text-center font-rubik-medium">
                  View Smart Analysis
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Completion State */}
        {onboardStep > 4 && (
          <View className="items-center py-12">
            <Text className="text-2xl font-rubik-bold text-green-600 mb-4">All Set!</Text>
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