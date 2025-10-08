// screens/Explore.tsx
import { fetchPlacesByCoordinates } from "@/lib/google";
import { generateItinerary } from "@/lib/itineraryAI";
import { reconstructItinerary } from "@/lib/itineraryOptimizer";
import { planMultiDayTrip } from "@/lib/multidayPlanner";
import { calculateScheduleStatus, generateScheduleAdjustments, saveScheduleAdjustment } from "@/lib/scheduleManager";
import { adaptItineraryForWeather, getDetailedWeather } from "@/lib/weatherAware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    Text,
    TouchableOpacity,
    View
} from "react-native";
// import MapView, { Marker, Polyline } from 'react-native-maps';

// Temporary fallback map component
const MapView = ({ children, style, region, showsUserLocation, showsMyLocationButton, initialRegion }: any) => (
  <View style={[style, { backgroundColor: '#e3f2fd', justifyContent: 'center', alignItems: 'center' }]}>
    <Text style={{ color: '#1976d2', fontSize: 16, fontWeight: 'bold' }}>🗺️ Map View</Text>
    <Text style={{ color: '#666', fontSize: 12, marginTop: 4 }}>Interactive map will be available</Text>
  </View>
);

const Marker = ({ coordinate, title, description, pinColor }: any) => null;
const Polyline = ({ coordinates, strokeColor, strokeWidth, lineDashPattern }: any) => null;

// ---------------- Utils ----------------
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371e3;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const timeToMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const minutesToTime = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const formatDuration = (minutes: number) => {
  if (!minutes && minutes !== 0) return "N/A";
  if (minutes < 60) return `${minutes} min${minutes !== 1 ? "s" : ""}`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hrs} hr${hrs !== 1 ? "s" : ""}`;
  return `${hrs} hr ${mins} min${mins !== 1 ? "s" : ""}`;
};

// ---------------- Map Utils ----------------
const getMapCoordinates = (itinerary: any[]) => {
  if (!itinerary || itinerary.length === 0) {
    console.log("🗺️ No itinerary provided for map coordinates");
    return [];
  }
  
  const coordinates = itinerary
    .filter(item => {
      const hasCoords = item.coordinates && item.coordinates.lat && item.coordinates.lng;
      if (!hasCoords) {
        console.log(`🗺️ Item "${item.name}" missing coordinates:`, item.coordinates);
      }
      return hasCoords;
    })
    .map(item => ({
      latitude: item.coordinates.lat,
      longitude: item.coordinates.lng,
      title: item.name,
      description: `${item.start_time} - ${item.end_time}`,
      category: item.category
    }));
  
  console.log(`🗺️ Extracted ${coordinates.length} map coordinates from ${itinerary.length} itinerary items`);
  return coordinates;
};

const getMapRegion = (coordinates: any[], userLocation?: { lat: number; lng: number }) => {
  if (coordinates.length === 0) {
    return {
      latitude: userLocation?.lat || 24.5225,
      longitude: userLocation?.lng || 54.4355,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1,
    };
  }

  const lats = coordinates.map(c => c.latitude);
  const lngs = coordinates.map(c => c.longitude);
  
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  
  const latDelta = (maxLat - minLat) * 1.2; // Add 20% padding
  const lngDelta = (maxLng - minLng) * 1.2;
  
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(latDelta, 0.01), // Minimum zoom level
    longitudeDelta: Math.max(lngDelta, 0.01),
  };
};

// ---------------- Debug helpers ----------------
const DEBUG_TRACK = true;
const dgroup = (name: string) => DEBUG_TRACK && console.group(`track:${name}`);
const dgroupCollapsed = (name: string) => DEBUG_TRACK && console.groupCollapsed(`track:${name}`);
const dend = () => DEBUG_TRACK && console.groupEnd();
const dlog = (label: string, payload?: any) => DEBUG_TRACK && console.log(label, payload ?? "");
const dwarn = (label: string, payload?: any) => DEBUG_TRACK && console.warn(label, payload ?? "");

// ---------------- Fatigue (simple distance-based for now) ----------------
// Maps total meters walked today → 0..1 score
// ~5km => ~0.35, 10km => ~0.6, 15km+ => ~0.85+, capped at 1.0
function distanceFatigueScore(totalMeters: number) {
  const km = totalMeters / 1000;
  const s = Math.min(1, Math.max(0, (km / 18))); // 18km ~ 1.0
  return Number(s.toFixed(3));
}

// ---------------- Component ----------------
export default function Explore() {
  const [loading, setLoading] = useState(false);

  const [rawResult, setRawResult] = useState<any>(null);
  const [optimizedResult, setOptimizedResult] = useState<any>(null);
  const [tripPlan, setTripPlan] = useState<any | null>(null);
  const [weatherAdaptedResult, setWeatherAdaptedResult] = useState<any>(null);

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [currentWeather, setCurrentWeather] = useState<any>(null);
  const [currentActivityIdx, setCurrentActivityIdx] = useState<number | null>(null);
  const [scheduleStatus, setScheduleStatus] = useState<any>(null);
  const [scheduleAdjustments, setScheduleAdjustments] = useState<any[]>([]);
  const [lastWeatherCheck, setLastWeatherCheck] = useState<number>(0);
  const [lastScheduleCheck, setLastScheduleCheck] = useState<number>(0);
  const [currentTripDayIndex, setCurrentTripDayIndex] = useState<number | null>(null);
  const [lastDateNotice, setLastDateNotice] = useState<number>(0);

  // tracking state
  const [isTracking, setIsTracking] = useState(false);
  const [totalMetersToday, setTotalMetersToday] = useState(0);
  const [fatigueScore, setFatigueScore] = useState(0);

  // refs
  const lastPointRef = useRef<{ lat: number; lng: number; ts: number } | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  // constants
  const TICK_INTERVAL_MS = 60_000; // 1 minute

  // ---------------- Location seed (passive) ----------------
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      // seed a one-shot location for initial map/itinerary highlighting
      const loc = await Location.getCurrentPositionAsync({});
      setUserLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    })();
  }, []);

  // ---------------- Load saved multi-day trip on mount ----------------
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem("savedTripPlan");
        if (saved) {
          const trip = JSON.parse(saved);
          setTripPlan(trip);
          console.log("📂 Auto-loaded saved multi-day trip");
        }
      } catch (err) {
        console.error("❌ Failed to auto-load saved trip", err);
      }
    })();
  }, []);

  // ---------------- Automatic schedule monitoring with location tracking ----------------
  useEffect(() => {
    if (!isTracking) return;
    if (!userLocation) return;

    // Helper to format local date as YYYY-MM-DD
    const localDateString = () => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${da}`;
    };

    // Prefer multi-day plan for tracking
    if (tripPlan?.days?.length) {
      const today = localDateString();
      const dayIdx = tripPlan.days.findIndex((d: any) => d.date === today);
      if (dayIdx === -1) {
        setCurrentTripDayIndex(null);
        setCurrentActivityIdx(null);
        setScheduleStatus(null);
        const now = Date.now();
        if (now - lastDateNotice > 60_000) {
          Alert.alert(
            "Outside Trip Dates",
            `Today (${today}) is outside your planned trip (${tripPlan.startDate} to ${tripPlan.endDate}). Tracking highlights are disabled.`
          );
          setLastDateNotice(now);
        }
        return;
      }
      setCurrentTripDayIndex(dayIdx);
      const todaysItinerary = tripPlan.days[dayIdx]?.itinerary || [];
      if (!todaysItinerary.length) {
        setCurrentActivityIdx(null);
        setScheduleStatus(null);
        return;
      }

      const idx = todaysItinerary.findIndex((item: any) => {
        const lat = item.lat ?? item.coordinates?.lat;
        const lng = item.lng ?? item.coordinates?.lng;
        if (lat == null || lng == null) return false;
        const d = haversineMeters(userLocation, { lat, lng });
        return d <= 120;
      });

      let newCurrentIdx: number | null = idx !== -1 ? idx : null;
      if (newCurrentIdx === null) {
        const now = new Date();
        const nowMins = now.getHours() * 60 + now.getMinutes();
        const withinNowIdx = todaysItinerary.findIndex((item: any) => {
          if (!item.start_time || !item.end_time) return false;
          const s = timeToMinutes(item.start_time);
          const e = timeToMinutes(item.end_time);
          return s <= nowMins && nowMins <= e;
        });
        if (withinNowIdx !== -1) newCurrentIdx = withinNowIdx;
        else {
          const upcomingIdx = todaysItinerary.findIndex((item: any) => {
            if (!item.start_time) return false;
            const s = timeToMinutes(item.start_time);
            return s > nowMins;
          });
          if (upcomingIdx !== -1) newCurrentIdx = upcomingIdx;
          else if (todaysItinerary.length > 0) newCurrentIdx = todaysItinerary.length - 1;
        }
      }

      setCurrentActivityIdx(newCurrentIdx);
      if (newCurrentIdx !== null) {
        const status = calculateScheduleStatus(todaysItinerary, newCurrentIdx);
        setScheduleStatus(status);

        const nowTs = Date.now();
        const timeSinceLastCheck = nowTs - lastScheduleCheck;
        if (status.isBehindSchedule && timeSinceLastCheck > 30000) {
          setLastScheduleCheck(nowTs);
          generateScheduleAdjustments(todaysItinerary, status, userLocation)
            .then(adjustments => {
              if (adjustments.length > 0) {
                setScheduleAdjustments(adjustments);
                showScheduleAdjustmentPrompt(adjustments);
              }
            })
            .catch(error => {
              console.error('❌ Failed to generate schedule adjustments:', error);
            });
        }
      }
      return;
    }

    // Fallback: single-day itineraries
    const itinerary = (weatherAdaptedResult?.itinerary || optimizedResult?.itinerary || rawResult?.itinerary);
    if (!itinerary) return;

    const idx = itinerary.findIndex((item: any) => {
      const lat = item.lat ?? item.coordinates?.lat;
      const lng = item.lng ?? item.coordinates?.lng;
      if (lat == null || lng == null) return false;
      const d = haversineMeters(userLocation, { lat, lng });
      return d <= 120; // within 120m
    });

    let newCurrentIdx: number | null = idx !== -1 ? idx : null;
    if (newCurrentIdx === null) {
      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes();
      const withinNowIdx = itinerary.findIndex((item: any) => {
        if (!item.start_time || !item.end_time) return false;
        const s = timeToMinutes(item.start_time);
        const e = timeToMinutes(item.end_time);
        return s <= nowMins && nowMins <= e;
      });
      if (withinNowIdx !== -1) newCurrentIdx = withinNowIdx;
      else {
        const upcomingIdx = itinerary.findIndex((item: any) => {
          if (!item.start_time) return false;
          const s = timeToMinutes(item.start_time);
          return s > nowMins;
        });
        if (upcomingIdx !== -1) newCurrentIdx = upcomingIdx;
        else if (itinerary.length > 0) newCurrentIdx = itinerary.length - 1;
      }
    }
    setCurrentActivityIdx(newCurrentIdx);
    if (newCurrentIdx !== null) {
      const status = calculateScheduleStatus(itinerary, newCurrentIdx);
      setScheduleStatus(status);
      const nowTs = Date.now();
      const timeSinceLastCheck = nowTs - lastScheduleCheck;
      if (status.isBehindSchedule && timeSinceLastCheck > 30000) {
        setLastScheduleCheck(nowTs);
        generateScheduleAdjustments(itinerary, status, userLocation)
          .then(adjustments => {
            if (adjustments.length > 0) {
              setScheduleAdjustments(adjustments);
              showScheduleAdjustmentPrompt(adjustments);
            }
          })
          .catch(error => {
            console.error('❌ Failed to generate schedule adjustments:', error);
          });
      }
    }
  }, [isTracking, userLocation, rawResult, optimizedResult, weatherAdaptedResult, tripPlan, lastScheduleCheck, lastDateNotice]);

  // ---------------- Generate / View / Optimize ----------------
  const handleGenerate = async () => {
    try {
      setLoading(true);
      setRawResult(null);
      setOptimizedResult(null);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") throw new Error("Location permission not granted");

      const loc = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = loc.coords;

      const places = await fetchPlacesByCoordinates(latitude, longitude);
      const rawItinerary = await generateItinerary(places, { lat: latitude, lng: longitude });
      
      // Map AI-generated place names back to full place objects with coordinates
      const enrichedItinerary = rawItinerary.itinerary.map((item: any) => {
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
        
        console.warn(`⚠️ Could not find coordinates for place: ${item.name}`);
        return item;
      });

      // Optimize the itinerary with coordinates
      const optimized = await reconstructItinerary({ lat: latitude, lng: longitude }, enrichedItinerary);
      
      const result = { ...rawItinerary, itinerary: optimized };
      await AsyncStorage.setItem("savedItinerary", JSON.stringify(result));
      setRawResult(result);

      Alert.alert("Success", "Itinerary saved locally!");
    } catch (err: any) {
      console.error("❌ Itinerary generation failed:", err?.message);
      setRawResult({ error: err?.message || "Unknown error" });
    } finally {
      setLoading(false);
    }
  };

  const handleViewSaved = async () => {
    try {
      const saved = await AsyncStorage.getItem("savedItinerary");
      if (saved) {
        setRawResult(JSON.parse(saved));
        console.log("📂 Viewing Saved Itinerary");
      } else {
        Alert.alert("No Saved Itinerary", "Please generate one first!");
      }
    } catch (err) {
      console.error("❌ Failed to load saved itinerary", err);
    }
  };

  const handleMultiDay = async () => {
    try {
      setLoading(true);
      console.log("🚀 Starting multi-day trip generation...");
      const trip = await planMultiDayTrip();
      setTripPlan(trip);
      await AsyncStorage.setItem("savedTripPlan", JSON.stringify(trip));
      Alert.alert("Success", `Multi-day trip generated! ${trip.days.length} days planned with ${trip.days.reduce((sum, day) => sum + day.itinerary.length, 0)} total activities.`);
    } catch (e: any) {
      console.error("❌ Trip generation failed:", e?.message);
      const errorMessage = e?.message || "Failed to generate trip";
      Alert.alert("Error", errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleViewSavedTrip = async () => {
    try {
      const saved = await AsyncStorage.getItem("savedTripPlan");
      if (saved) {
        const trip = JSON.parse(saved);
        setTripPlan(trip);
        console.log("📂 Viewing Saved Multi-day Trip");
      } else {
        Alert.alert("No Saved Trip", "Please generate a multi-day trip first!");
      }
    } catch (err) {
      console.error("❌ Failed to load saved trip", err);
      Alert.alert("Error", "Failed to load saved trip");
    }
  };

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

      // We optimize the raw list for route & realistic times
      const optimized = await reconstructItinerary(
        { lat: latitude, lng: longitude },
        itinerary
      );

      const obj = { itinerary: optimized };
      setOptimizedResult(obj);

      await AsyncStorage.setItem("optimizedItinerary", JSON.stringify(obj));

      Alert.alert("Success", "Optimized itinerary saved!");
      console.log("✅ Optimized Itinerary");
    } catch (err: any) {
      console.error("❌ Optimization failed:", err?.message);
      Alert.alert("Error", err?.message || "Optimization failed");
    }
  };

  // ---------------- Tracking (start/stop) ----------------
  const startTracking = useCallback(async () => {
    if (isTracking) return;
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Please enable location permission.");
      return;
    }

    dgroup("start");
    dlog("when", new Date().toISOString());
    dlog("intervalMs", TICK_INTERVAL_MS);
    dend();

    setIsTracking(true);
    setTotalMetersToday(0);
    setFatigueScore(0);
    lastPointRef.current = null;

    // Live GPS stream
    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 10_000,
        distanceInterval: 10, // update every ~10m
      },
      (loc) => {
        const { latitude, longitude, accuracy, speed } = loc.coords;
        const point = { lat: latitude, lng: longitude };
        setUserLocation(point);

        dgroupCollapsed("gps");
        dlog("coords", { lat: latitude, lng: longitude });
        dlog("accuracy(m)", accuracy);
        dlog("speed(m/s)", speed);
        dend();
      }
    );
    watchRef.current = sub;

    // Periodic tick (aggregate + fatigue)
    tickerRef.current = setInterval(() => {
      const now = Date.now();
      const curr = userLocation;
      if (!curr) {
        dlog("tick:skip", "no userLocation yet");
        return;
      }

      if (!lastPointRef.current) {
        lastPointRef.current = { ...curr, ts: now };
        dlog("tick:init", curr);
        return;
      }

      const prev = lastPointRef.current;
      const meters = haversineMeters({ lat: prev.lat, lng: prev.lng }, curr);
      lastPointRef.current = { ...curr, ts: now };

      // Update totals
      setTotalMetersToday((prevMeters) => {
        const next = prevMeters + meters;

        // Compute fatigue (distance only for now)
        const f = distanceFatigueScore(next);
        setFatigueScore(f);

        // Tick logs
        dgroup("tick");
        dlog("delta", {
          metersSinceLast: Math.round(meters),
          elapsedSec: Math.round((now - prev.ts) / 1000),
        });
        dlog("dayStats", { totalMeters: Math.round(next) });
        dlog("fatigue.score", f);
        dend();

        return next;
      });
    }, TICK_INTERVAL_MS);
  }, [isTracking, userLocation]);

  const stopTracking = useCallback(() => {
    if (!isTracking) return;
    dgroup("stop");
    dlog("when", new Date().toISOString());
    dend();

    setIsTracking(false);
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (watchRef.current) {
      watchRef.current.remove();
      watchRef.current = null;
    }
  }, [isTracking]);

  useEffect(() => {
    return () => {
      // cleanup on unmount
      if (tickerRef.current) clearInterval(tickerRef.current);
      if (watchRef.current) watchRef.current.remove();
    };
  }, []);

  // ---------------- Automatic Weather Detection & Adaptation ----------------
  const checkWeatherAndAdapt = useCallback(async (showAlert = false) => {
    if (!userLocation) {
      if (showAlert) {
        Alert.alert("Location Required", "Please enable location to check weather");
      }
      return;
    }

    try {
      console.log("🌤️ Auto-checking weather and adapting itinerary...");
      
      const weather = await getDetailedWeather(userLocation.lat, userLocation.lng);
      if (!weather) {
        if (showAlert) {
          Alert.alert("Weather Unavailable", "Could not fetch weather data");
        }
        return;
      }

      setCurrentWeather(weather);
      setLastWeatherCheck(Date.now());
      console.log(`🌧️ Current weather: ${weather.condition} (${weather.temperature}°C)`);

      // Adapt current itinerary if available
      if (optimizedResult?.itinerary) {
        const { adaptedItinerary, changes } = await adaptItineraryForWeather(
          optimizedResult.itinerary,
          userLocation,
          currentActivityIdx || 0
        );

        if (changes.length > 0) {
          setWeatherAdaptedResult({ itinerary: adaptedItinerary });
          console.log(`🔄 Weather adaptation applied: ${changes.length} changes due to ${weather.condition} weather`);
          
          if (showAlert) {
            Alert.alert(
              "Weather Adaptation Applied",
              `Made ${changes.length} changes due to ${weather.condition} weather:\n\n${changes.join('\n')}`
            );
          }
        } else {
          console.log(`✅ Weather is suitable for current itinerary (${weather.condition})`);
          if (showAlert) {
            Alert.alert("Weather Check Complete", `Weather is suitable for your current itinerary (${weather.condition})`);
          }
        }
      } else {
        console.log(`🌤️ Weather checked: ${weather.condition} (${weather.temperature}°C)`);
        if (showAlert) {
          Alert.alert("Weather Check Complete", `Current weather: ${weather.condition} (${weather.temperature}°C)`);
        }
      }
    } catch (error) {
      console.error("❌ Weather adaptation failed:", error);
      if (showAlert) {
        Alert.alert("Error", "Failed to check weather and adapt itinerary");
      }
    }
  }, [userLocation, optimizedResult, currentActivityIdx]);

  // ---------------- Automatic Weather Checking (Every Hour) ----------------
  useEffect(() => {
    const checkWeatherInterval = () => {
      const now = Date.now();
      const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds
      
      // Check if it's been more than an hour since last weather check
      if (now - lastWeatherCheck > oneHour) {
        console.log("⏰ Hourly weather check triggered");
        checkWeatherAndAdapt(false); // Silent check, no alerts
      }
    };

    // Check weather immediately when location is available
    if (userLocation && lastWeatherCheck === 0) {
      console.log("📍 Initial weather check on location detection");
      checkWeatherAndAdapt(false);
    }

    // Set up interval to check every 15 minutes (to catch the 1-hour mark)
    const weatherInterval = setInterval(checkWeatherInterval, 15 * 60 * 1000);

    return () => {
      clearInterval(weatherInterval);
    };
  }, [userLocation, lastWeatherCheck, checkWeatherAndAdapt]);

  // ---------------- Schedule Adjustment Prompts ----------------
  const showScheduleAdjustmentPrompt = useCallback(async (adjustments: any[]) => {
    if (adjustments.length === 0) return;

    const adjustment = adjustments[0]; // Show the first (best) adjustment
    
    Alert.alert(
      "⏰ Schedule Adjustment Needed",
      `You're ${scheduleStatus?.delayMinutes || 0} minutes behind schedule.\n\n${adjustment.description}\n\nImpact: ${adjustment.impact}`,
      [
        {
          text: "Apply This Change",
          onPress: () => applyScheduleAdjustment(adjustment),
          style: "default"
        },
        {
          text: "See All Options",
          onPress: () => showAllAdjustmentOptions(adjustments),
          style: "default"
        },
        {
          text: "Not Now",
          onPress: () => {
            console.log("User postponed schedule adjustment");
            // Reset the last check time to allow checking again later
            setLastScheduleCheck(Date.now() - 25000); // Allow checking again in 5 seconds
          },
          style: "cancel"
        }
      ]
    );
  }, [scheduleStatus]);

  const showAllAdjustmentOptions = useCallback(async (adjustments: any[]) => {
    const options = adjustments.map((adj, index) => ({
      text: `${adj.type.replace('_', ' ').toUpperCase()}: ${adj.description}`,
      onPress: () => applyScheduleAdjustment(adj)
    }));

    options.push({
      text: "Cancel",
      onPress: async () => {
        console.log("User cancelled schedule adjustment");
        // Reset the last check time to allow checking again later
        setLastScheduleCheck(Date.now() - 25000);
      }
    });

    Alert.alert(
      "Choose Schedule Adjustment",
      "Select how you'd like to adjust your schedule:",
      options
    );
  }, []);

  const applyScheduleAdjustment = useCallback(async (adjustment: any) => {
    try {
      console.log("🔄 Applying schedule adjustment:", adjustment.type);
      
      // Update the optimized result with the new itinerary
      setOptimizedResult({ itinerary: adjustment.newItinerary });
      
      // Save the adjustment for reference
      await saveScheduleAdjustment(adjustment);
      
      // Clear the adjustments list
      setScheduleAdjustments([]);
      
      Alert.alert(
        "✅ Schedule Updated",
        `Applied: ${adjustment.description}\n\nTime saved: ${adjustment.timeSaved} minutes`
      );
      
    } catch (error) {
      console.error("❌ Failed to apply schedule adjustment:", error);
      Alert.alert("Error", "Failed to apply schedule adjustment");
    }
  }, []);

  // ---------------- Reflow From Now (manual trigger placeholder) ----------------
  const handleReflowFromNow = useCallback(async () => {
    if (!optimizedResult?.itinerary || !userLocation) return;
    try {
      const remaining = optimizedResult.itinerary.filter((it: any, idx: number) => {
        if (currentActivityIdx == null) return true;
        return idx >= currentActivityIdx;
      });

      // Here you could call a smarter reflow that respects hours & fatigue
      const reflowed = await reconstructItinerary(userLocation, remaining);
      setOptimizedResult({ itinerary: reflowed });

      dgroup("reflow:run");
      dlog("trigger", { reason: "manual", now: new Date().toISOString() });
      dlog("remainingStops(after)", reflowed.map((r: any) => r.name));
      dend();
    } catch (e) {
      console.error("reflow failed", e);
    }
  }, [optimizedResult, userLocation, currentActivityIdx]);

  // ---------------- Rendering helpers ----------------
  const renderItinerary = (result: any, title: string) => {
    if (!result?.itinerary) return null;

    const itinerary = result.itinerary;

    // Calculate progress
    const totalActivities = itinerary.length;
    const completedActivities = currentActivityIdx !== null ? currentActivityIdx : 0;
    const progressPercentage = totalActivities > 0 ? (completedActivities / totalActivities) * 100 : 0;

    return (
      <>
        <Text className="text-xl font-rubik-bold mb-4">{title}</Text>
        
        {/* Location Status */}
        {isTracking && currentActivityIdx === null && (weatherAdaptedResult?.itinerary || optimizedResult?.itinerary || rawResult?.itinerary) && (
          <View className="mb-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
            <Text className="text-sm font-rubik-semibold text-yellow-800">Not at any scheduled location</Text>
            <Text className="text-xs text-yellow-600 mt-1">
              Move closer to a scheduled activity to track your progress
            </Text>
          </View>
        )}

        {/* Progress Bar */}
        {isTracking && currentActivityIdx !== null && (
          <View className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-sm font-rubik-semibold text-gray-700">Schedule Progress</Text>
              <Text className="text-sm text-gray-600">
                {completedActivities}/{totalActivities} activities
              </Text>
            </View>
            <View className="w-full bg-gray-200 rounded-full h-2">
              <View 
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              />
            </View>
            <Text className="text-xs text-gray-500 mt-1">
              {progressPercentage.toFixed(0)}% complete
            </Text>
          </View>
        )}
        {itinerary.map((item: any, idx: number) => {
          const isCurrent = isTracking && currentActivityIdx === idx;
          const isCompleted = isTracking && currentActivityIdx !== null && idx < currentActivityIdx;
          const isUpcoming = isTracking && currentActivityIdx !== null && idx > currentActivityIdx;
          const isOverdue = isTracking && scheduleStatus?.isBehindSchedule && isCurrent;
          
          // Determine the visual state
          let containerClass = "mb-6 p-4 rounded-lg border";
          let textClass = "text-lg font-rubik-bold";
          let statusIndicator = "";
          
          if (isCompleted) {
            containerClass += " bg-gray-100 border-gray-300";
            textClass += " text-gray-600";
            
          } else if (isCurrent) {
            if (isOverdue) {
              containerClass += " bg-red-100 border-2 border-red-500";
              textClass += " text-red-700";
              
            } else {
              containerClass += " bg-green-100 border-2 border-green-500";
              textClass += " text-green-700";
              
            }
          } else if (isUpcoming) {
            containerClass += " bg-blue-50 border-blue-200";
            textClass += " text-blue-700";
            
          } else {
            containerClass += " bg-white border-gray-200";
            textClass += " text-gray-900";
          }
          
          return (
            <View key={`${item.name}-${idx}`} className={containerClass}>
              <Text className={textClass}>{item.start_time} – {item.end_time} {item.name}</Text>

              <Text className="text-sm text-gray-600 capitalize">
                {item.category ?? "activity"}
              </Text>

              {/* Current Activity Status */}
              {isTracking && isCurrent && (
                <View className="mt-2 p-2 rounded bg-blue-50 border border-blue-200">
                  <Text className="text-sm font-rubik-semibold text-blue-800">
                    {isOverdue ? `You are ${scheduleStatus?.delayMinutes || 0} minutes behind schedule` : "You are here - Current activity"}
                  </Text>
                  {isOverdue && (
                    <Text className="text-xs text-blue-600 mt-1">
                      Consider adjusting your schedule to catch up
                    </Text>
                  )}
                </View>
              )}

              {/* Completed Activity Status */}
              {isTracking && isCompleted && (
                <View className="mt-2 p-2 rounded bg-gray-50 border border-gray-200">
                  <Text className="text-sm font-rubik-semibold text-gray-600">Completed</Text>
                </View>
              )}

              {/* Upcoming Activity Status */}
              {isTracking && isUpcoming && (
                <View className="mt-2 p-2 rounded bg-blue-50 border border-blue-200">
                  <Text className="text-sm font-rubik-semibold text-blue-700">Upcoming</Text>
                  {scheduleStatus?.nextActivityStart && idx === currentActivityIdx + 1 && (
                    <Text className="text-xs text-blue-600 mt-1">
                      Next activity starts at {scheduleStatus.nextActivityStart}
                    </Text>
                  )}
                </View>
              )}

              {item.estimated_duration != null && (
                <Text className="text-sm text-gray-600">
                  Duration: {typeof item.estimated_duration === "number"
                    ? formatDuration(item.estimated_duration)
                    : item.estimated_duration}
                </Text>
              )}

              {item.travel_time_minutes != null && (
                <Text className="text-sm text-gray-600">
                  Transit: {item.travel_time_minutes} min
                </Text>
              )}

              {item.travel_instructions && (
                <Text className="text-sm text-gray-600 mt-1">
                  {item.travel_instructions}
                </Text>
              )}

              {item.reason && (
                <Text className="text-sm text-gray-500 italic mt-1">{item.reason}</Text>
              )}

              {item.weatherWarning && (
                <View className="mt-2 p-2 bg-yellow-100 rounded border border-yellow-300">
                  <Text className="text-sm text-yellow-800 font-rubik-semibold">{item.weatherWarning}</Text>
                </View>
              )}

              {item.adaptationReason && (
                <View className="mt-2 p-2 bg-blue-100 rounded border border-blue-300">
                  <Text className="text-sm text-blue-800 font-rubik-semibold">Weather Adaptation: {item.adaptationReason}</Text>
                  {item.originalActivity && (
                    <Text className="text-xs text-blue-600 mt-1">
                      Originally: {item.originalActivity}
                    </Text>
                  )}
                </View>
              )}

              {item.replacementReason && (
                <View className="mt-2 p-2 bg-purple-100 rounded border border-purple-300">
                  <Text className="text-sm text-purple-800 font-rubik-semibold">Schedule Adjustment: {item.replacementReason}</Text>
                  {item.originalActivity && (
                    <Text className="text-xs text-purple-600 mt-1">
                      Originally: {item.originalActivity}
                    </Text>
                  )}
                </View>
              )}

              {item.rescheduled && (
                <View className="mt-2 p-2 bg-orange-100 rounded border border-orange-300">
                  <Text className="text-sm text-orange-800 font-rubik-semibold">Rescheduled due to delay</Text>
                </View>
              )}
            </View>
          );
        })}
      </>
    );
  };

  // ---------------- UI ----------------
  const fatigueBadge = useMemo(
    () => (
      <View className="flex-row items-center justify-between mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200">
        <Text className="font-rubik-semibold">
          Fatigue: {(fatigueScore * 100).toFixed(0)}%
        </Text>
        <Text className="text-gray-600">
          Distance: {(totalMetersToday / 1000).toFixed(2)} km
        </Text>
        <Text className={`px-2 py-1 rounded ${isTracking ? "bg-green-200" : "bg-gray-200"}`}>
          {isTracking ? "Tracking" : "Idle"}
        </Text>
      </View>
    ),
    [fatigueScore, totalMetersToday, isTracking]
  );

  const weatherBadge = useMemo(
    () => {
      if (!currentWeather) return null;
      
      const getWeatherColor = (condition: string) => {
        if (['Rain', 'Thunderstorm', 'Snow'].includes(condition)) return 'bg-red-100 border-red-300';
        if (['Clouds', 'Overcast'].includes(condition)) return 'bg-yellow-100 border-yellow-300';
        return 'bg-green-100 border-green-300';
      };

      const getTimeSinceLastCheck = () => {
        if (!lastWeatherCheck) return "Just now";
        const minutesAgo = Math.floor((Date.now() - lastWeatherCheck) / (1000 * 60));
        if (minutesAgo < 1) return "Just now";
        if (minutesAgo < 60) return `${minutesAgo}m ago`;
        const hoursAgo = Math.floor(minutesAgo / 60);
        return `${hoursAgo}h ago`;
      };

      return (
        <View className={`mb-4 p-3 rounded-lg border ${getWeatherColor(currentWeather.condition)}`}>
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="font-rubik-semibold text-lg">
                🌤️ {currentWeather.condition}
              </Text>
              <Text className="text-sm text-gray-600">
                {currentWeather.temperature}°C • {currentWeather.humidity}% humidity
              </Text>
              <Text className="text-xs text-gray-500 mt-1">
                Auto-checked {getTimeSinceLastCheck()}
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-xs text-gray-500">
                {new Date(currentWeather.timestamp).toLocaleTimeString()}
              </Text>
              <Text className="text-xs text-green-600 font-rubik-medium">
                Auto-updating
              </Text>
            </View>
          </View>
        </View>
      );
    },
    [currentWeather, lastWeatherCheck]
  );

  const scheduleBadge = useMemo(
    () => {
      if (!scheduleStatus || !optimizedResult?.itinerary) return null;
      
      const getScheduleColor = (status: any) => {
        if (status.isBehindSchedule) return 'bg-red-100 border-red-300';
        if (status.isOnTime) return 'bg-green-100 border-green-300';
        return 'bg-yellow-100 border-yellow-300';
      };

      return (
        <View className={`mb-4 p-3 rounded-lg border ${getScheduleColor(scheduleStatus)}`}>
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="font-rubik-semibold text-lg">
                ⏰ Schedule Status (Auto)
              </Text>
              <Text className="text-sm text-gray-600">
                {scheduleStatus.isBehindSchedule 
                  ? `${scheduleStatus.delayMinutes} min behind` 
                  : 'On schedule'}
              </Text>
              {scheduleStatus.nextActivityStart && (
                <Text className="text-xs text-gray-500">
                  Next: {scheduleStatus.nextActivityStart}
                </Text>
              )}
            </View>
            <Text className={`px-2 py-1 rounded text-xs font-rubik-semibold ${
              scheduleStatus.isBehindSchedule ? 'bg-red-200 text-red-800' : 'bg-green-200 text-green-800'
            }`}>
              {scheduleStatus.isBehindSchedule ? 'BEHIND' : 'ON TIME'}
            </Text>
          </View>
        </View>
      );
    },
    [scheduleStatus, optimizedResult]
  );

  // Get current itinerary for map
  const currentItinerary = weatherAdaptedResult?.itinerary || optimizedResult?.itinerary || rawResult?.itinerary;
  const mapCoordinates = getMapCoordinates(currentItinerary || []);
  const mapRegion = getMapRegion(mapCoordinates, userLocation || undefined);

  return (
    <View className="h-full bg-white" style={{ paddingTop: 50 }}>
      <ScrollView contentContainerClassName="pb-32">
        
        {/* Header */}
        <View className="px-7 pt-4 pb-2">
          <Text className="text-2xl font-rubik-bold mb-2">TripTune Explorer</Text>
          <Text className="text-gray-600">Your AI-powered travel companion</Text>
        </View>

        {/* Status Badges */}
        <View className="px-7 mb-4">
          {fatigueBadge}
          {weatherBadge}
          {scheduleBadge}
        </View>

        {/* Map temporarily disabled per request to avoid related errors */}

        {/* Main Action Buttons */}
        <View className="px-7 mb-6">
          <View className="flex-row gap-3">
            <TouchableOpacity 
              onPress={handleGenerate} 
              className="flex-1 bg-primary-100 py-4 px-6 rounded-xl"
            >
              <Text className="text-white text-center font-rubik-bold text-lg">
                Generate Trip
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={isTracking ? stopTracking : startTracking}
              className={`flex-1 py-4 px-6 rounded-xl bg-primary-100`}
            >
              <Text className="text-white text-center font-rubik-bold text-lg">
                {isTracking ? "Stop Tracking" : "Start Tracking"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Secondary Actions */}
        <View className="px-7 mb-6">
          <View className="flex-row gap-3">
            <TouchableOpacity 
              onPress={handleMultiDay} 
              className="flex-1 bg-primary-100 py-4 px-6 rounded-xl"
            >
              <Text className="text-white text-center font-rubik-bold text-lg">
                Multi-day
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={handleViewSavedTrip}
              className="flex-1 bg-primary-100 py-4 px-6 rounded-xl"
            >
              <Text className="text-white text-center font-rubik-bold text-lg">
                Saved Trip
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Schedule/Itinerary Display */}
        <View className="px-7">
          {loading && (
            <View className="items-center justify-center py-8">
              <ActivityIndicator size="large" color="#0061ff" />
              <Text className="text-gray-500 mt-4">Processing...</Text>
            </View>
          )}

          {rawResult?.itinerary && renderItinerary(rawResult, "AI Generated Itinerary")}
          {optimizedResult?.itinerary && renderItinerary(optimizedResult, "Optimized Itinerary")}
          {weatherAdaptedResult?.itinerary && renderItinerary(weatherAdaptedResult, "🌤️ Weather-Adapted Itinerary")}
          {tripPlan?.days?.length ? (
            <View className="mt-8">
              <View className="bg-blue-50 p-4 rounded-lg mb-6 border border-blue-200">
                <View className="flex-row justify-between items-start mb-2">
                  <View className="flex-1">
                    <Text className="text-2xl font-rubik-bold text-blue-800">
                      Multi-day Trip Plan
                    </Text>
                    <Text className="text-lg font-rubik-semibold text-blue-700">
                      {tripPlan.startDate} → {tripPlan.endDate}
                    </Text>
                    <Text className="text-sm text-blue-600 mt-1">
                      {tripPlan.days.length} days • {tripPlan.days.reduce((sum: number, day: any) => sum + day.itinerary.length, 0)} total activities
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setTripPlan(null);
                      AsyncStorage.removeItem("savedTripPlan");
                    }}
                    className="bg-red-100 px-3 py-1 rounded"
                  >
                    <Text className="text-red-700 text-xs font-rubik-semibold">Clear</Text>
                  </TouchableOpacity>
                </View>
              </View>
              
              {tripPlan.days.map((d: any, dayIndex: number) => (
                <View key={d.date} className="mb-8">
                  <View className="bg-gray-100 p-3 rounded-lg mb-4">
                    <Text className="text-xl font-rubik-bold text-gray-800">
                      Day {dayIndex + 1}: {d.date}
                    </Text>
                    <Text className="text-sm text-gray-600">
                      {d.itinerary.length} activities planned
                    </Text>
                  </View>
                  
                  {d.itinerary.length > 0 ? (
                    d.itinerary.map((item: any, idx: number) => (
                      <View key={`${d.date}-${idx}`} className="mb-4 p-4 rounded-lg bg-white border border-gray-200 shadow-sm">
                        <View className="flex-row items-center justify-between mb-2">
                          <Text className="text-lg font-rubik-bold text-gray-900 flex-1">
                            {item.name}
                          </Text>
                          <View className="bg-blue-100 px-2 py-1 rounded">
                            <Text className="text-xs font-rubik-semibold text-blue-800">
                              {item.start_time} - {item.end_time}
                            </Text>
                          </View>
                        </View>
                        
                        <Text className="text-sm text-gray-600 capitalize mb-1">
                          {item.category ?? "activity"}
                        </Text>
                        
                        {item.estimated_duration != null && (
                            <Text className="text-sm text-gray-600 mb-1">
                              Duration: {typeof item.estimated_duration === "number"
                              ? formatDuration(item.estimated_duration)
                              : item.estimated_duration}
                          </Text>
                        )}
                        
                        {item.travel_time_minutes != null && item.travel_time_minutes > 0 && (
                            <Text className="text-sm text-gray-600 mb-1">
                              Transit: {item.travel_time_minutes} min
                          </Text>
                        )}
                        
                        {item.travel_instructions && (
                            <Text className="text-sm text-gray-500 mb-1">
                            {item.travel_instructions}
                          </Text>
                        )}
                        
                        {item.reason && (
                          <Text className="text-sm text-gray-500 italic mt-2 p-2 bg-gray-50 rounded">
                            {item.reason}
                          </Text>
                        )}
                      </View>
                    ))
                  ) : (
                    <View className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                      <Text className="text-gray-500 text-center font-rubik-semibold">
                        No activities planned for this day
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          ) : null}

          {rawResult?.error && (
            <Text className="text-red-500 mt-4">Error: {rawResult.error}</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
