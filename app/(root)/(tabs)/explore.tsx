// screens/Explore.tsx
import { reconstructItinerary } from "@/lib/itineraryOptimizer";
import { planMultiDayTrip, type MultiDayProgressUpdate } from "@/lib/multidayPlanner";
import {
  adjustItineraryForCurrentLocation,
  allocateTransitionTime,
  checkPlanForToday,
  checkUserLocationMismatch,
  findNearestTouristSite,
  regenerateItineraryAfterReplacement,
  validateReplacement,
} from "@/lib/personalize";
import { calculateScheduleStatus, generateScheduleAdjustments, saveScheduleAdjustment } from "@/lib/scheduleManager";
import { checkWeatherForOutdoorActivities } from "@/lib/weatherAware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";

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

// Timeline helpers
const getTimelineStartTime = (itinerary: any[], userStartTime?: string): number => {
  // Use user's preferred start time if provided
  if (userStartTime) {
    const userStartMinutes = timeToMinutes(userStartTime);
    // Round down to nearest hour
    return Math.floor(userStartMinutes / 60) * 60;
  }
  
  // Otherwise, use earliest activity time or default to 9:00 AM
  if (!itinerary || itinerary.length === 0) return 9 * 60;
  const earliest = Math.min(...itinerary.map((item: any) => {
    if (!item.start_time) return 9 * 60;
    return timeToMinutes(item.start_time);
  }));
  // Round down to nearest hour
  return Math.floor(earliest / 60) * 60;
};

const getTimelineEndTime = (): number => {
  return 21 * 60; // 9:00 PM (21:00)
};

const getTimePosition = (timeStr: string, startTime: number, endTime: number, totalHeight: number): number => {
  const timeMinutes = timeToMinutes(timeStr);
  const totalMinutes = endTime - startTime;
  const minutesFromStart = timeMinutes - startTime;
  const percentage = minutesFromStart / totalMinutes;
  return percentage * totalHeight;
};

const getDurationHeight = (startTimeStr: string, endTimeStr: string, startTime: number, endTime: number, totalHeight: number): number => {
  const startPos = getTimePosition(startTimeStr, startTime, endTime, totalHeight);
  const endPos = getTimePosition(endTimeStr, startTime, endTime, totalHeight);
  return endPos - startPos;
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
    console.log("No itinerary provided for map coordinates");
    return [];
  }
  
  const coordinates = itinerary
    .filter(item => {
      const hasCoords = item.coordinates && item.coordinates.lat && item.coordinates.lng;
      if (!hasCoords) {
        console.log(`Item "${item.name}" missing coordinates:`, item.coordinates);
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
  
  console.log(`Extracted ${coordinates.length} map coordinates from ${itinerary.length} itinerary items`);
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
// Maps total meters walked today -> 0..1 score
// ~5km => ~0.35, 10km => ~0.6, 15km+ => ~0.85+, capped at 1.0
function distanceFatigueScore(totalMeters: number) {
  const km = totalMeters / 1000;
  const s = Math.min(1, Math.max(0, (km / 18))); // 18km ~ 1.0
  return Number(s.toFixed(3));
}

// ---------------- Component ----------------
export default function Explore() {
  const [loading, setLoading] = useState(false);

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
  const [replaceContext, setReplaceContext] = useState<{ dayIndex: number; itemIndex: number } | null>(null);
  const [replacementSuggestions, setReplacementSuggestions] = useState<any[] | null>(null);
  
  // Weather-related state
  const lastWeatherCheckRef = useRef<number>(0);
  
  // Location mismatch tracking state
  const lastLocationMismatchCheckRef = useRef<number>(0);
  const locationMismatchPromptShownRef = useRef<boolean>(false);
  
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(0); // For UI day selection
  const [itineraryStartTime, setItineraryStartTime] = useState<string | undefined>(undefined);
  const [expandedTransport, setExpandedTransport] = useState<Set<string>>(new Set()); // Track which transport sections are expanded
  const [expandedFood, setExpandedFood] = useState<Set<string>>(new Set()); // Track which food suggestion sections are expanded
  const [expandedReason, setExpandedReason] = useState<Set<string>>(new Set()); // Track which reason sections are expanded
  const [expandedActivityCards, setExpandedActivityCards] = useState<Set<string>>(new Set()); // Track which activity cards are expanded

  // tracking state
  const [isTracking, setIsTracking] = useState(false);
  const [totalMetersToday, setTotalMetersToday] = useState(0);
  const [fatigueScore, setFatigueScore] = useState(0);

  const [loadingStatus, setLoadingStatus] = useState<MultiDayProgressUpdate | null>(null);
  const [loadingTimeline, setLoadingTimeline] = useState<MultiDayProgressUpdate[]>([]);

  // refs
  const lastPointRef = useRef<{ lat: number; lng: number; ts: number } | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  // constants
  const TICK_INTERVAL_MS = 60_000; // 1 minute

  const fetchStoredItineraryStart = async (): Promise<string | undefined> => {
    try {
      const raw = await AsyncStorage.getItem("tripContext");
      if (!raw) return undefined;
      const parsed = JSON.parse(raw);
      const start = typeof parsed?.itineraryStartTime === "string" ? parsed.itineraryStartTime.trim() : "";
      return start ? start : undefined;
    } catch (error) {
      console.warn("Unable to read preferred itinerary start time", error);
      return undefined;
    }
  };

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
        // Load itinerary start time preference
        const storedStartTime = await fetchStoredItineraryStart();
        if (storedStartTime) {
          setItineraryStartTime(storedStartTime);
        }
        
        const saved = await AsyncStorage.getItem("savedTripPlan");
        if (saved) {
          const trip = JSON.parse(saved);
          setTripPlan(trip);
          console.log("Auto-loaded saved multi-day trip");
          
          // Auto-select today's day if it exists
          if (trip?.days?.length) {
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const todayIndex = trip.days.findIndex((d: any) => d.date === todayStr);
            if (todayIndex !== -1) {
              setSelectedDayIndex(todayIndex);
            } else {
              setSelectedDayIndex(0); // Default to first day
            }
          }
        }
      } catch (err) {
        console.error("Failed to auto-load saved trip", err);
      }
    })();
  }, []);

  // ---------------- Location Mismatch Detection and Handling ----------------
  const checkAndHandleLocationMismatch = useCallback(async (
    itinerary: any[],
    currentActivityIndex: number,
    userLocation: { lat: number; lng: number },
    dayIndex?: number
  ) => {
    // Don't check if prompt was recently shown (within 5 minutes)
    const timeSinceLastCheck = Date.now() - lastLocationMismatchCheckRef.current;
    if (locationMismatchPromptShownRef.current && timeSinceLastCheck < 300000) {
      return; // Don't show again too soon (within 5 minutes)
    }

    const mismatch = checkUserLocationMismatch(userLocation, itinerary, currentActivityIndex, 500);
    
    if (!mismatch.isFar || !mismatch.plannedActivity) {
      return; // User is at or near planned location
    }

    // User is far from planned location - prompt them
    locationMismatchPromptShownRef.current = true;
    
    Alert.alert(
      "Location Mismatch Detected",
      mismatch.message || `You are far from "${mismatch.plannedActivity.name}". Would you like to allocate more transition time?`,
      [
        {
          text: "Yes, Add Transition Time",
          onPress: async () => {
            try {
              const adjustedItinerary = allocateTransitionTime(
                itinerary, 
                currentActivityIndex, 
                15
              );
              
              // Update the itinerary
              if (tripPlan && dayIndex !== null && dayIndex !== undefined) {
                const newPlan = { ...tripPlan };
                const dayCopy = { ...newPlan.days[dayIndex] };
                dayCopy.itinerary = adjustedItinerary;
                newPlan.days = [...newPlan.days];
                newPlan.days[dayIndex] = dayCopy;
                setTripPlan(newPlan);
                await AsyncStorage.setItem("savedTripPlan", JSON.stringify(newPlan));
                
                if (dayIndex === selectedDayIndex) {
                  setOptimizedResult({ itinerary: adjustedItinerary });
                }
              } else {
                if (weatherAdaptedResult) {
                  setWeatherAdaptedResult({ itinerary: adjustedItinerary });
                } else {
                  setOptimizedResult({ itinerary: adjustedItinerary });
                }
              }
              
              Alert.alert("Schedule Adjusted", "Added 15 minutes transition time and adjusted subsequent activities.");
            } catch (error) {
              console.error("Failed to allocate transition time:", error);
              Alert.alert("Error", "Failed to adjust schedule");
            }
          },
        },
        {
          text: "No",
          style: "cancel",
          onPress: async () => {
            // Ask if they want to change schedule based on current location
            Alert.alert(
              "Change Schedule?",
              "Would you like to change the schedule based on your current location? This will add the nearest tourist site as your next destination.",
              [
                {
                  text: "Yes, Change Schedule",
                  onPress: async () => {
                    try {
                      // Get used place IDs to exclude
                      const usedPlaceIds = new Set<string>();
                      itinerary.forEach(item => {
                        if (item.place_id) usedPlaceIds.add(item.place_id);
                      });

                      // Find nearest tourist site
                      const nearestSite = await findNearestTouristSite(userLocation, usedPlaceIds, 10);
                      
                      if (!nearestSite) {
                        Alert.alert("No Nearby Sites", "No suitable tourist sites found near your current location.");
                        return;
                      }

                      // Get start time
                      const startTime = await fetchStoredItineraryStart();
                      
                      // Adjust itinerary
                      const adjustedItinerary = await adjustItineraryForCurrentLocation(
                        itinerary,
                        currentActivityIndex,
                        userLocation,
                        nearestSite,
                        {
                          startTime,
                          userLocation,
                        }
                      );

                      // Update the itinerary
                      if (tripPlan && dayIndex !== null && dayIndex !== undefined) {
                        const newPlan = { ...tripPlan };
                        const dayCopy = { ...newPlan.days[dayIndex] };
                        dayCopy.itinerary = adjustedItinerary;
                        newPlan.days = [...newPlan.days];
                        newPlan.days[dayIndex] = dayCopy;
                        setTripPlan(newPlan);
                        await AsyncStorage.setItem("savedTripPlan", JSON.stringify(newPlan));
                        
                        if (dayIndex === selectedDayIndex) {
                          setOptimizedResult({ itinerary: adjustedItinerary });
                        }
                      } else {
                        if (weatherAdaptedResult) {
                          setWeatherAdaptedResult({ itinerary: adjustedItinerary });
                        } else {
                          setOptimizedResult({ itinerary: adjustedItinerary });
                        }
                      }
                      
                      Alert.alert(
                        "Schedule Updated",
                        `Added "${nearestSite.name}" to your itinerary based on your current location.`
                      );
                    } catch (error) {
                      console.error("Failed to adjust itinerary for current location:", error);
                      Alert.alert("Error", "Failed to update schedule based on location");
                    }
                  },
                },
                {
                  text: "No, Keep Original",
                  style: "cancel",
                  onPress: () => {
                    console.log("User chose to keep original schedule");
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }, [tripPlan, selectedDayIndex, weatherAdaptedResult, optimizedResult, userLocation]);

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
      // Auto-select today's day in UI when tracking starts
      if (isTracking && selectedDayIndex !== dayIdx) {
        setSelectedDayIndex(dayIdx);
      }
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
        
        // Check for location mismatch (every 2 minutes or when activity changes)
        const timeSinceLocationCheck = nowTs - lastLocationMismatchCheckRef.current;
        if (timeSinceLocationCheck > 120000 || newCurrentIdx !== currentActivityIdx) {
          lastLocationMismatchCheckRef.current = nowTs;
          checkAndHandleLocationMismatch(todaysItinerary, newCurrentIdx, userLocation, dayIdx);
        }
        
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
              console.error('Failed to generate schedule adjustments:', error);
            });
        }
      }
      return;
    }

    // Fallback: single-day itineraries
    const fallbackDayIndex = (currentTripDayIndex != null && tripPlan?.days?.[currentTripDayIndex]) ? currentTripDayIndex : 0;
    const itinerary = weatherAdaptedResult?.itinerary || optimizedResult?.itinerary || tripPlan?.days?.[fallbackDayIndex]?.itinerary;
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
      
      // Check for location mismatch (every 2 minutes or when activity changes)
      const timeSinceLocationCheck = nowTs - lastLocationMismatchCheckRef.current;
      if (timeSinceLocationCheck > 120000 || newCurrentIdx !== currentActivityIdx) {
        lastLocationMismatchCheckRef.current = nowTs;
        checkAndHandleLocationMismatch(itinerary, newCurrentIdx, userLocation);
      }
      
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
            console.error('Failed to generate schedule adjustments:', error);
          });
      }

      // Check weather for outdoor activities (every 5 minutes or when activity changes)
      const timeSinceLastWeatherCheck = nowTs - lastWeatherCheckRef.current;
      if (timeSinceLastWeatherCheck > 300000 || newCurrentIdx !== currentActivityIdx) { // 5 minutes or activity changed
        lastWeatherCheckRef.current = nowTs;
        // This will be handled by the useEffect below that checks weather periodically
      }
    }
  }, [isTracking, userLocation, optimizedResult, weatherAdaptedResult, tripPlan, currentTripDayIndex, lastScheduleCheck, lastDateNotice, selectedDayIndex, currentActivityIdx, checkAndHandleLocationMismatch]);

  // ---------------- Generate / View / Optimize ----------------
  const resetLoadingStatus = useCallback(() => {
    setLoadingStatus(null);
    setLoadingTimeline([]);
  }, []);

  const handleStatusUpdate = useCallback((update: MultiDayProgressUpdate) => {
    setLoadingStatus(update);
    setLoadingTimeline((prev) => {
      const filtered = prev.filter((item) => item.stage !== update.stage);
      return [...filtered, update];
    });
  }, []);

  const runMultiDayGeneration = useCallback(
    async ({ silent }: { silent?: boolean } = {}) => {
    try {
      setLoading(true);
        resetLoadingStatus();
        handleStatusUpdate({ stage: "init", message: "Starting multi-day trip planning...", progress: 0.02 });

        const trip = await planMultiDayTrip({
          onStatus: (update) => {
            if (!update) return;
            handleStatusUpdate(update);
          },
        });
 
        setTripPlan(trip);
        const initialItinerary = trip.days?.[0]?.itinerary ?? [];
        if (initialItinerary.length) {
          setOptimizedResult({ itinerary: initialItinerary });
          setCurrentTripDayIndex(0);
        } else {
          setOptimizedResult(null);
        }
        setWeatherAdaptedResult(null);
        
        // Auto-select today's day if it exists, otherwise default to first day
        if (trip?.days?.length) {
          const today = new Date();
          const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          const todayIndex = trip.days.findIndex((d: any) => d.date === todayStr);
          if (todayIndex !== -1) {
            setSelectedDayIndex(todayIndex);
            setCurrentTripDayIndex(todayIndex);
      } else {
            setSelectedDayIndex(0);
          }
        }
        
      await AsyncStorage.setItem("savedTripPlan", JSON.stringify(trip));

        // Notification removed - trip plan is displayed directly
    } catch (e: any) {
        console.error("Trip generation failed:", e?.message || e);
        if (!silent) {
          Alert.alert("Error", e?.message || "Failed to generate trip");
        }
    } finally {
      setLoading(false);
        resetLoadingStatus();
      }
    },
    [handleStatusUpdate, resetLoadingStatus]
  );

  const handleMultiDay = useCallback(() => {
    runMultiDayGeneration({ silent: false });
  }, [runMultiDayGeneration]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      (async () => {
        try {
          const flag = await AsyncStorage.getItem("pendingAutoGenerateTripPlan");
          if (flag === "1") {
            console.log("Auto-generating multi-day trip after preference save");
            await AsyncStorage.removeItem("pendingAutoGenerateTripPlan");
            if (!isActive) return;
            await runMultiDayGeneration({ silent: false });
      }
    } catch (err) {
          console.error("Failed to handle pending auto generation", err);
    }
      })();

      return () => {
        isActive = false;
  };
    }, [runMultiDayGeneration])
  );

  // ---------------- Multi-day: Replace item with recommendations ----------------
  const getUsedPlaceNamesFromTripPlan = useCallback((): Set<string> => {
    const used = new Set<string>();
    if (!tripPlan?.days?.length) return used;
    tripPlan.days.forEach((d: any) => {
      (d.itinerary || []).forEach((it: any) => {
        if (it?.name) used.add(it.name);
      });
    });
    return used;
  }, [tripPlan]);

  const recommendReplacements = useCallback(async (lat: number, lng: number, excludeNames: Set<string>, dayIndex?: number) => {
    // Prefer precomputed pool for the day for speed and relevance
    if (typeof dayIndex === 'number' && tripPlan?.days?.[dayIndex]?.pool?.length) {
      const pool = tripPlan.days[dayIndex].pool as any[];
      const eligible = pool.filter(p => p?.name && !excludeNames.has(p.name));
      return eligible.slice(0, 3);
    }
    // Fallback to live fetch
    try {
      // This function is no longer imported, so this will cause an error.
      // Assuming fetchPlacesByCoordinates is no longer available or needs to be re-imported.
      // For now, commenting out or removing this call as it's not in the new_code.
      // const results = await fetchPlacesByCoordinates(lat, lng);
      // const eligible = results
      //   .filter((p: any) => p?.name && !excludeNames.has(p.name))
      //   .sort((a: any, b: any) => (b.rating || 0) - (a.rating || 0));
      // return eligible.slice(0, 3);
      console.warn("fetchPlacesByCoordinates is no longer imported, cannot recommend replacements.");
      return [];
    } catch (e) {
      console.error("recommendReplacements failed", e);
      return [];
    }
  }, [tripPlan]);

  const handleReplaceMultiDayItem = useCallback(async (dayIndex: number, itemIndex: number) => {
    try {
      if (!tripPlan?.days?.[dayIndex]) return;
      const day = tripPlan.days[dayIndex];
      const item = day.itinerary[itemIndex];
      if (!item) return;

      const baseLat = item.lat ?? item.coordinates?.lat ?? userLocation?.lat;
      const baseLng = item.lng ?? item.coordinates?.lng ?? userLocation?.lng;
      if (baseLat == null || baseLng == null) {
        Alert.alert("Location needed", "Cannot suggest replacements without a reference location.");
        return;
      }

      // Auto-expand the card when Replace is clicked so replacement suggestions are visible
      const itemKey = `${day.date}-${itemIndex}`;
      setExpandedActivityCards(prev => {
        const newSet = new Set<string>();
        newSet.add(itemKey);
        return newSet;
      });

      const exclude = getUsedPlaceNamesFromTripPlan();
      const suggestions = await recommendReplacements(baseLat, baseLng, exclude, dayIndex);
      setReplaceContext({ dayIndex, itemIndex });
      setReplacementSuggestions(suggestions);
    } catch (e: any) {
      console.error("handleReplaceMultiDayItem failed", e?.message || e);
      Alert.alert("Error", "Failed to replace item.");
    }
  }, [tripPlan, userLocation, getUsedPlaceNamesFromTripPlan, recommendReplacements]);

  const applyReplacementSelection = useCallback(async (dayIndex: number, itemIndex: number, p: any) => {
    if (!tripPlan?.days?.[dayIndex]) return;
    const day = tripPlan.days[dayIndex];
    const item = day.itinerary[itemIndex];
    if (!item) return;

    // Validate replacement
    const validation = validateReplacement({
      place_id: p.place_id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
    });

    if (!validation.valid) {
      Alert.alert("Error", validation.error || "Invalid replacement place");
      return;
    }

    if (!userLocation) {
      Alert.alert("Location Required", "Location is needed to regenerate the itinerary");
      return;
    }

    try {
      // Show loading indicator
      Alert.alert("Regenerating", "Re-generating itinerary with new activity and adjusted times...");

      // Get start time for the day
      const startTime = await fetchStoredItineraryStart();

      // Regenerate itinerary with the replacement
      const reoptimized = await regenerateItineraryAfterReplacement(
        day.itinerary,
        itemIndex,
        {
      place_id: p.place_id,
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          category: p.category ?? item.category ?? "activity",
      photoUrl: p.photoUrl,
      rating: p.rating,
      user_ratings_total: p.user_ratings_total,
        },
        {
          userLocation,
          startTime,
        }
      );

      // Update trip plan with regenerated itinerary
    const newPlan = { ...tripPlan };
    const dayCopy = { ...newPlan.days[dayIndex] };
      dayCopy.itinerary = reoptimized;
    newPlan.days = [...newPlan.days];
    newPlan.days[dayIndex] = dayCopy;
    setTripPlan(newPlan);
    await AsyncStorage.setItem("savedTripPlan", JSON.stringify(newPlan));

      // Update optimized result if viewing the same day
      if (dayIndex === selectedDayIndex) {
        setOptimizedResult({ itinerary: reoptimized });
      }

    setReplaceContext(null);
    setReplacementSuggestions(null);

      Alert.alert(
        "Replaced & Regenerated",
        `"${item.name}" has been replaced with "${p.name}" and the itinerary has been regenerated with adjusted times.`
      );
    } catch (error: any) {
      console.error("Failed to apply replacement and regenerate:", error);
      Alert.alert("Error", error?.message || "Failed to replace activity and regenerate itinerary");
    }
  }, [tripPlan, userLocation, selectedDayIndex]);

  const cancelReplacement = useCallback(() => {
    setReplaceContext(null);
    setReplacementSuggestions(null);
  }, []);

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
      const startTime = await fetchStoredItineraryStart();
      const optimized = await reconstructItinerary(
        { lat: latitude, lng: longitude },
        itinerary,
        { startTime }
      );

      const obj = { itinerary: optimized };
      setOptimizedResult(obj);

      await AsyncStorage.setItem("optimizedItinerary", JSON.stringify(obj));

      Alert.alert("Success", "Optimized itinerary saved!");
      console.log("Optimized itinerary saved");
    } catch (err: any) {
      console.error("Optimization failed:", err?.message);
      Alert.alert("Error", err?.message || "Optimization failed");
    }
  };

  // ---------------- Tracking (start/stop) ----------------
  const startTracking = useCallback(async () => {
    if (isTracking) return;
    
    // Check if there's a plan for today
    if (tripPlan) {
      const planCheck = checkPlanForToday(tripPlan);
      if (!planCheck.hasPlan) {
        Alert.alert(
          "No Plan for Today",
          "There is no trip plan scheduled for today. Please generate a multi-day plan or ensure your trip dates include today."
        );
        return;
      }
    } else if (!optimizedResult?.itinerary && !weatherAdaptedResult?.itinerary) {
      Alert.alert(
        "No Itinerary",
        "No itinerary available to track. Please generate a plan first."
      );
      return;
    }
    
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

  // ---------------- Weather Replacement Prompt ----------------
  const showWeatherReplacementPrompt = useCallback((result: {
    activity: any;
    activityIndex: number;
    alternatives: any[];
    weather: any;
  }) => {
    if (!result.alternatives || result.alternatives.length === 0) return;

    const { activity, activityIndex, alternatives, weather } = result;
    
    // Build alert message with 3 alternatives
    const alternativesList = alternatives
      .map((alt, idx) => `${idx + 1}. ${alt.name}${alt.rating ? ` (⭐ ${alt.rating})` : ''}`)
      .join('\n');

            Alert.alert(
      "🌧️ Rain Detected",
      `We detected that it is raining. Would you like to replace "${activity.name}" (outdoor activity) with one of these indoor alternatives?\n\n${alternativesList}\n\nNote: Only remaining activities will be affected.`,
      [
        {
          text: alternatives[0]?.name || "Option 1",
          onPress: () => applyWeatherReplacement(activityIndex, alternatives[0], activity),
        },
        {
          text: alternatives[1]?.name || "Option 2",
          onPress: () => applyWeatherReplacement(activityIndex, alternatives[1], activity),
        },
        {
          text: alternatives[2]?.name || "Option 3",
          onPress: () => applyWeatherReplacement(activityIndex, alternatives[2], activity),
        },
        {
          text: "Keep Original",
          style: "cancel",
          onPress: () => {
            console.log("User chose to keep outdoor activity despite rain");
          }
        }
      ],
      { cancelable: true }
    );
  }, []);

  const applyWeatherReplacement = useCallback(async (
    activityIndex: number,
    alternative: any,
    originalActivity: any
  ) => {
    if (!userLocation) {
      Alert.alert("Location Required", "Location is needed to re-optimize the itinerary");
      return;
    }

    try {
      // Show loading indicator
      Alert.alert("Reoptimizing", "Re-generating itinerary with new activity and adjusted times...");

      let currentItinerary: any[] = [];
      let isMultiDay = false;
      let dayIndex = currentTripDayIndex;

      // Get the current itinerary
      if (tripPlan && currentTripDayIndex !== null) {
        // Multi-day trip
        const day = tripPlan.days[currentTripDayIndex];
        if (day && day.itinerary) {
          currentItinerary = [...day.itinerary];
          isMultiDay = true;
        }
      } else {
        // Single-day itinerary
        currentItinerary = [...(weatherAdaptedResult?.itinerary || optimizedResult?.itinerary || [])];
      }

      if (activityIndex < 0 || activityIndex >= currentItinerary.length) {
        Alert.alert("Error", "Invalid activity index");
        return;
      }

      // Ensure the alternative has required location fields
      const altLat = alternative.lat || alternative.coordinates?.lat;
      const altLng = alternative.lng || alternative.coordinates?.lng;
      
      if (!altLat || !altLng) {
        Alert.alert("Error", "Alternative location information is missing");
        return;
      }

      // Use the personalize function to regenerate itinerary with replacement
      // This handles opening hours, time adjustments, and route optimization
      const startTime = await fetchStoredItineraryStart();
      console.log("Regenerating itinerary after weather replacement...");
      
      const reoptimized = await regenerateItineraryAfterReplacement(
        currentItinerary,
        activityIndex,
        {
          place_id: alternative.place_id || originalActivity.place_id,
          name: alternative.name,
          lat: altLat,
          lng: altLng,
          category: alternative.category || originalActivity.category || 'indoor',
          photoUrl: alternative.photoUrl || originalActivity.photoUrl,
          rating: alternative.rating ?? originalActivity.rating,
          user_ratings_total: alternative.user_ratings_total ?? originalActivity.user_ratings_total,
        },
        {
          userLocation,
          startTime,
          replacementMetadata: {
            isWeatherReplacement: true,
            weatherReason: 'Replaced due to rain',
            replacementReason: 'Weather-based replacement',
          },
        }
      );

      if (!reoptimized || reoptimized.length === 0) {
        Alert.alert("Error", "Failed to re-optimize itinerary");
        return;
      }

      // Update the itinerary with re-optimized times
      if (isMultiDay && tripPlan && dayIndex !== null) {
        // Update multi-day trip plan
        const newPlan = { ...tripPlan };
        const dayCopy = { ...newPlan.days[dayIndex] };
        dayCopy.itinerary = reoptimized;
        newPlan.days = [...newPlan.days];
        newPlan.days[dayIndex] = dayCopy;
        setTripPlan(newPlan);
        await AsyncStorage.setItem("savedTripPlan", JSON.stringify(newPlan));
        
        // Also update optimized result if viewing the same day
        if (dayIndex === selectedDayIndex) {
          setOptimizedResult({ itinerary: reoptimized });
          }
        } else {
        // Update single-day itinerary
        if (weatherAdaptedResult) {
          setWeatherAdaptedResult({ itinerary: reoptimized });
      } else {
          setOptimizedResult({ itinerary: reoptimized });
        }
      }

      Alert.alert(
        "Replaced & Re-optimized",
        `"${originalActivity.name}" has been replaced with "${alternative.name}" and the itinerary times have been adjusted.`
      );
    } catch (error) {
      console.error("Failed to apply weather replacement:", error);
      Alert.alert("Error", "Failed to replace and re-optimize activity");
      }
  }, [optimizedResult, weatherAdaptedResult, tripPlan, currentTripDayIndex, selectedDayIndex, userLocation]);

  // ---------------- Periodic Weather Checking During Tracking ----------------
  useEffect(() => {
    if (!isTracking || !userLocation) return;

    const checkWeatherForRain = async () => {
      try {
        // Get the correct itinerary based on trip plan or single-day
        let itinerary: any[] = [];
        let activityIndex = currentActivityIdx;

        if (tripPlan && currentTripDayIndex !== null) {
          // Multi-day trip - use current day's itinerary
          const day = tripPlan.days[currentTripDayIndex];
          if (day && day.itinerary) {
            itinerary = day.itinerary;
        }
      } else {
          // Single-day itinerary
          itinerary = weatherAdaptedResult?.itinerary || optimizedResult?.itinerary || [];
        }

        if (itinerary.length === 0 || activityIndex === null || activityIndex < 0) {
          return;
        }

        const result = await checkWeatherForOutdoorActivities(
          itinerary,
          userLocation,
          activityIndex
        );

        if (result && result.needsAdaptation && result.alternatives.length > 0) {
          showWeatherReplacementPrompt(result);
        }
      } catch (error) {
        console.error("Failed to check weather for rain:", error);
      }
    };

    // Check immediately when tracking starts or when current activity changes
    checkWeatherForRain();

    // Check every 5 minutes while tracking
    const weatherInterval = setInterval(checkWeatherForRain, 5 * 60 * 1000);

    return () => {
      clearInterval(weatherInterval);
    };
  }, [isTracking, userLocation, weatherAdaptedResult, optimizedResult, currentActivityIdx, tripPlan, currentTripDayIndex, showWeatherReplacementPrompt]);

  // ---------------- Schedule Adjustment Prompts ----------------
  const showScheduleAdjustmentPrompt = useCallback(async (adjustments: any[]) => {
    if (adjustments.length === 0) return;

    const adjustment = adjustments[0]; // Show the first (best) adjustment
    
    Alert.alert(
      "Schedule Adjustment Needed",
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
      console.log("Applying schedule adjustment:", adjustment.type);
      
      // Update the optimized result with the new itinerary
      setOptimizedResult({ itinerary: adjustment.newItinerary });
      
      // Save the adjustment for reference
      await saveScheduleAdjustment(adjustment);
      
      // Clear the adjustments list
      setScheduleAdjustments([]);
      
      Alert.alert(
        "Schedule Updated",
        `Applied: ${adjustment.description}\n\nTime saved: ${adjustment.timeSaved} minutes`
      );
      
    } catch (error) {
      console.error("Failed to apply schedule adjustment:", error);
      Alert.alert("Error", "Failed to apply schedule adjustment");
    }
  }, []);

  useEffect(() => {
    if (!tripPlan?.days?.length) return;
    const idx = (currentTripDayIndex != null && tripPlan.days[currentTripDayIndex]) ? currentTripDayIndex : 0;
    const itinerary = tripPlan.days[idx]?.itinerary ?? [];
    if (!itinerary.length) return;
    if (weatherAdaptedResult?.itinerary?.length) return;

    setOptimizedResult((prev: any) => {
      const prevKey = Array.isArray(prev?.itinerary)
        ? prev.itinerary.map((item: any) => item.place_id ?? `${item.name}-${item.start_time}`).join("|")
        : "";
      const nextKey = itinerary.map((item: any) => item.place_id ?? `${item.name}-${item.start_time}`).join("|");
      if (prevKey === nextKey) return prev;
      return { itinerary };
    });
  }, [tripPlan, currentTripDayIndex, weatherAdaptedResult]);

  // ---------------- Reflow From Now (manual trigger placeholder) ----------------
  const handleReflowFromNow = useCallback(async () => {
    if (!optimizedResult?.itinerary || !userLocation) return;
    try {
      const remaining = optimizedResult.itinerary.filter((it: any, idx: number) => {
        if (currentActivityIdx == null) return true;
        return idx >= currentActivityIdx;
      });

      // Here you could call a smarter reflow that respects hours & fatigue
      const startTime = await fetchStoredItineraryStart();
      const reflowed = await reconstructItinerary(userLocation, remaining, { startTime });
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
        {isTracking && currentActivityIdx === null && Array.isArray(currentItinerary) && currentItinerary.length > 0 && (
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
              <Text className={textClass}>{item.start_time} - {item.end_time} {item.name}</Text>

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
                {currentWeather.condition}
              </Text>
              <Text className="text-sm text-gray-600">
                {currentWeather.temperature} C - {currentWeather.humidity}% humidity
              </Text>
              <Text className="text-xs text-gray-500 mt-1">
                Auto-checked {getTimeSinceLastCheck()}
              </Text>
            </View>
            <View className="items-end">
              {currentWeather.timestamp && (
              <Text className="text-xs text-gray-500">
                {new Date(currentWeather.timestamp).toLocaleTimeString()}
              </Text>
              )}
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
                Schedule Status (Auto)
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
  const currentItinerary =
    weatherAdaptedResult?.itinerary ||
    optimizedResult?.itinerary ||
    (currentTripDayIndex != null && tripPlan?.days?.[currentTripDayIndex]?.itinerary) ||
    (tripPlan?.days?.[0]?.itinerary) ||
    [];
  const mapCoordinates = getMapCoordinates(currentItinerary || []);
  const mapRegion = getMapRegion(mapCoordinates, userLocation || undefined);

  return (
    <View className="h-full bg-white" style={{ paddingTop: 50 }}>
      <ScrollView contentContainerClassName="pb-32">
        <>
        {/* Header */}
        <View className="px-7 pt-4 pb-2">
          <Text className="text-2xl font-rubik-bold mb-2">TripTune Explorer</Text>
        </View>

          {/* Status Badges - Only show when tracking */}
          {isTracking && (
        <View className="px-7 mb-4">
          {fatigueBadge}
          {weatherBadge}
          {scheduleBadge}
        </View>
          )}

        {/* Map temporarily disabled per request to avoid related errors */}

        {/* Main Action Buttons */}
        <View className="px-7 mb-6">
            <TouchableOpacity
              onPress={isTracking ? stopTracking : startTracking}
              className="w-full bg-primary-100 py-4 px-6 rounded-xl"
            >
              <Text className="text-white text-center font-rubik-bold text-lg">
                {isTracking ? "Stop Tracking" : "Start Tracking"}
              </Text>
            </TouchableOpacity>
        </View>

        <View className="px-7 mb-6">
            <TouchableOpacity 
              onPress={handleMultiDay} 
              disabled={loading}
              className={`w-full py-4 px-6 rounded-xl ${loading ? 'bg-gray-400' : 'bg-primary-100'}`}
            >
              {loading ? (
                <View className="items-center">
                  <ActivityIndicator size="small" color="#FFFFFF" className="mb-2" />
              <Text className="text-white text-center font-rubik-bold text-lg">
                    Generating Plan...
              </Text>
                  {loadingStatus && (
                    <>
                      <Text className="text-white text-center font-rubik-medium text-sm mt-1">
                        {loadingStatus.message}
                      </Text>
                      {typeof loadingStatus.progress === "number" && (
                        <View className="w-full mt-3">
                          <View className="h-2 bg-white/30 rounded-full overflow-hidden">
                            <View
                              className="h-2 bg-white rounded-full"
                              style={{ width: `${Math.min(100, Math.max(0, loadingStatus.progress * 100))}%` }}
                            />
                          </View>
                          <Text className="text-white text-xs text-center mt-1">
                            {Math.round((loadingStatus.progress || 0) * 100)}% complete
                          </Text>
                        </View>
                      )}
                    </>
                  )}
                </View>
              ) : (
              <Text className="text-white text-center font-rubik-bold text-lg">
                  Generate Multi-day Plan
              </Text>
              )}
            </TouchableOpacity>
        </View>

          {/* Schedule/Itinerary Display - Only show when tracking is active */}
          {isTracking && (
        <View className="px-7">
          {loading && (
            <View className="mb-8 p-5 rounded-2xl bg-white border border-gray-200 shadow-sm">
              <View className="flex-row items-center gap-3">
                <ActivityIndicator size="small" color="#0061ff" />
                <Text className="text-gray-800 font-rubik-semibold flex-1">
                  {loadingStatus?.message ?? "Processing..."}
              </Text>
            </View>
              {loadingStatus?.detail && (
                <Text className="text-gray-500 text-sm mt-2">{loadingStatus.detail}</Text>
              )}
              {typeof loadingStatus?.progress === "number" && (
                <View className="mt-3">
                  <View className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <View
                      className="h-2 bg-primary-100 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(0, loadingStatus.progress * 100))}%` }}
                    />
        </View>
                  <Text className="text-xs text-gray-500 mt-1">
                    {Math.round((loadingStatus.progress || 0) * 100)}% complete
                    </Text>
                </View>
              )}
              {loadingTimeline.length > 0 && (
                <View className="mt-4">
                  {loadingTimeline
                    .slice()
                    .sort((a, b) => (a.progress ?? 0) - (b.progress ?? 0))
                    .map((entry) => (
                      <View key={entry.stage} className="mb-2">
                        <Text className="text-xs font-rubik-semibold text-gray-700">
                          {entry.message}
                    </Text>
                        {entry.detail && (
                          <Text className="text-xs text-gray-500 mt-0.5">{entry.detail}</Text>
                        )}
                  </View>
                    ))}
                </View>
              )}
            </View>
          )}

              {!loading && optimizedResult?.itinerary && renderItinerary(optimizedResult, "Optimized Itinerary")}
              {!loading && weatherAdaptedResult?.itinerary && renderItinerary(weatherAdaptedResult, "Weather-Adapted Itinerary")}
            </View>
          )}

          {/* Trip Plan Overview - Always visible (when trip exists) */}
          {!loading && tripPlan?.days?.length && (
            <View className="px-7 mt-6">
              {/* Day Selector - Minimalistic horizontal tabs */}
              <View className="mb-4">
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingRight: 16 }}
                >
                  {tripPlan.days.map((day: any, dayIndex: number) => {
                    const isSelected = selectedDayIndex === dayIndex;
                    
                    return (
                  <TouchableOpacity
                        key={day.date}
                        onPress={() => setSelectedDayIndex(dayIndex)}
                        className={`mr-2 px-3 py-2 rounded ${
                          isSelected 
                            ? 'bg-primary-100' 
                            : 'bg-gray-100'
                        }`}
                      >
                        <Text className={`font-rubik-medium ${
                          isSelected ? 'text-white' : 'text-gray-700'
                        }`}>
                          Day {dayIndex + 1}
              </Text>
                  </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
              
            {/* Selected Day Itinerary */}
            {tripPlan.days[selectedDayIndex] && (() => {
              const selectedDay = tripPlan.days[selectedDayIndex];
              const dayMapCoordinates = getMapCoordinates(selectedDay.itinerary || []);
              const dayMapRegion = getMapRegion(dayMapCoordinates, userLocation ?? undefined);
              const routeCoordinates = dayMapCoordinates.map(coord => ({
                latitude: coord.latitude,
                longitude: coord.longitude,
              }));

              // Format date: "2025-11-24" -> "2025 11 24"
              const formatDate = (dateStr: string) => {
                return dateStr.replace(/-/g, ' ');
              };

              return (
                <View>
                  {/* Day Header */}
                  <View className="mb-4">
                    <Text className="text-xl font-rubik-bold text-gray-800">
                      Day {selectedDayIndex + 1}
                    </Text>
                    <Text className="text-sm text-gray-500 mt-1">
                      {formatDate(selectedDay.date)}
                    </Text>
                  </View>
                  
                  {/* Map showing all stops for this day */}
                  {dayMapCoordinates.length > 0 && (
                    <View className="mb-4 rounded-2xl overflow-hidden border border-gray-200 bg-white" style={{ height: 300 }}>
                      <MapView
                        style={{ flex: 1 }}
                        initialRegion={dayMapRegion}
                        region={dayMapRegion}
                        showsUserLocation={false}
                        showsMyLocationButton={false}
                      >
                        {/* Route polyline connecting all stops */}
                        {routeCoordinates.length > 1 && (
                          <Polyline
                            coordinates={routeCoordinates}
                            strokeColor="#0061ff"
                            strokeWidth={3}
                            lineDashPattern={[5, 5]}
                          />
                        )}
                        
                        {/* Markers for each stop */}
                        {dayMapCoordinates.map((coord, idx) => (
                          <Marker
                            key={`${selectedDay.date}-${idx}-${coord.latitude}-${coord.longitude}`}
                            coordinate={{ latitude: coord.latitude, longitude: coord.longitude }}
                            title={`${idx + 1}. ${coord.title}`}
                            description={coord.description}
                            pinColor={idx === 0 ? "#00ff00" : idx === dayMapCoordinates.length - 1 ? "#ff0000" : "#0061ff"}
                          />
                        ))}
                      </MapView>
            </View>
          )}

                  {/* Activities Timeline View */}
                  {selectedDay.itinerary.length > 0 ? (() => {
                    // Calculate timeline parameters using user's start time preference
                    const timelineStart = getTimelineStartTime(selectedDay.itinerary, itineraryStartTime);
                    const timelineEnd = getTimelineEndTime();
                    const timelineStartHours = Math.floor(timelineStart / 60);
                    const timelineEndHours = Math.floor(timelineEnd / 60);
                    
                    // Generate time labels for the left bar (every hour)
                    const timeLabels: number[] = [];
                    for (let hour = timelineStartHours; hour <= timelineEndHours; hour++) {
                      timeLabels.push(hour * 60);
                    }
                    
                    // Sort itinerary by start time, preserving original indices
                    const sortedItinerary = selectedDay.itinerary.map((item: any, idx: number) => ({
                      ...item,
                      originalIndex: idx
                    })).sort((a: any, b: any) => {
                      return timeToMinutes(a.start_time || "09:00") - timeToMinutes(b.start_time || "09:00");
                    });
                    
                    // Calculate minimum height per hour (in pixels)
                    const MIN_HEIGHT_PER_HOUR = 80; // Minimum 80px per hour
                    const totalHours = timelineEndHours - timelineStartHours;
                    const timelineHeight = Math.max(totalHours * MIN_HEIGHT_PER_HOUR, sortedItinerary.length * 100);
                    
                    // Format hour as "9am", "10am", "12pm", "1pm", etc.
                    const formatHourLabel = (hour: number): string => {
                      if (hour === 0) return '12am';
                      if (hour < 12) return `${hour}am`;
                      if (hour === 12) return '12pm';
                      return `${hour - 12}pm`;
                    };

                    // Color coding by category
                    const getCategoryColor = (category: string | undefined): string => {
                      const cat = (category || '').toLowerCase();
                      if (cat.includes('museum') || cat.includes('cultural')) return '#8B5CF6'; // Purple
                      if (cat.includes('park') || cat.includes('nature') || cat.includes('outdoor') || cat.includes('garden')) return '#10B981'; // Green
                      if (cat.includes('landmark') || cat.includes('monument') || cat.includes('architecture')) return '#F59E0B'; // Amber
                      if (cat.includes('theme') || cat.includes('entertainment') || cat.includes('adventure')) return '#EF4444'; // Red
                      if (cat.includes('beach') || cat.includes('waterfront') || cat.includes('island')) return '#06B6D4'; // Cyan
                      if (cat.includes('religious') || cat.includes('heritage')) return '#6366F1'; // Indigo
                      return '#6B7280'; // Default gray
                    };

                    return (
                      <View className="flex-row">
                        {/* Time Bar - Left side (18% width for better spacing to prevent cutoff) */}
                        <View style={{ width: '18%', position: 'relative', minHeight: timelineHeight }} className="pr-3">
                          {/* Vertical timeline line */}
                          <View 
                            style={{
                              position: 'absolute',
                              left: 12,
                              top: 0,
                              bottom: 0,
                              width: 2,
                              backgroundColor: '#E5E7EB',
                            }}
                          />
                          
                          {timeLabels.map((timeMinutes) => {
                            const hour = Math.floor(timeMinutes / 60);
                            const displayTime = minutesToTime(timeMinutes);
                            const position = getTimePosition(displayTime, timelineStart, timelineEnd, timelineHeight);
                            
                            return (
                              <View
                                key={timeMinutes}
                                style={{
                                  position: 'absolute',
                                  top: position - 8, // Adjust to center text on the line
                                  left: 0,
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                }}
                              >
                                {/* Hour marker dot */}
                                <View 
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: 4,
                                    backgroundColor: '#0B2545',
                                    marginRight: 6,
                                  }}
                                />
                                <Text className="text-sm text-gray-600 font-rubik-medium" numberOfLines={1}>
                                  {formatHourLabel(hour)}
                          </Text>
                  </View>
                            );
                          })}
                        </View>
                        
                        {/* Activities Timeline - Right side (82% width) */}
                        <View style={{ width: '82%', position: 'relative', minHeight: timelineHeight }}>
                          {/* Vertical connector line down the center */}
                          <View 
                            style={{
                              position: 'absolute',
                              left: '50%',
                              top: 0,
                              bottom: 0,
                              width: 2,
                              backgroundColor: '#E5E7EB',
                              zIndex: 0,
                              transform: [{ translateX: -1 }], // Center the 2px line
                            }}
                          />
                          
                          {/* Connecting dots at activity positions */}
                          {sortedItinerary.map((item: any, idx: number) => {
                            if (!item.start_time) return null;
                            const startPos = getTimePosition(item.start_time, timelineStart, timelineEnd, timelineHeight);
                            const primaryColor = '#0B2545'; // Match Start Tracking button color
                            
                            return (
                              <View
                                key={`dot-${idx}`}
                                style={{
                                  position: 'absolute',
                                  left: '50%',
                                  top: startPos - 6,
                                  width: 12,
                                  height: 12,
                                  borderRadius: 6,
                                  backgroundColor: primaryColor,
                                  borderWidth: 2,
                                  borderColor: '#FFFFFF',
                                  zIndex: 10,
                                  transform: [{ translateX: -6 }], // Center the dot
                                }}
                              />
                            );
                          })}
                          {sortedItinerary.map((item: any, idx: number) => {
                            if (!item.start_time || !item.end_time) return null;
                            
                            const top = getTimePosition(item.start_time, timelineStart, timelineEnd, timelineHeight);
                            const height = getDurationHeight(item.start_time, item.end_time, timelineStart, timelineEnd, timelineHeight);
                            const minHeight = 60; // Minimum visible height for each activity (compact view)
                            const itemKey = `${selectedDay.date}-${item.originalIndex}`;
                            const isExpanded = expandedActivityCards.has(itemKey);
                            
                            // Calculate dynamic spacing to prevent overlaps
                            let adjustedTop = top;
                            let previousBottom = 0;
                            
                            // Check previous cards to ensure no overlap
                            for (let prevIdx = 0; prevIdx < idx; prevIdx++) {
                              const prevItem = sortedItinerary[prevIdx];
                              if (!prevItem.start_time || !prevItem.end_time) continue;
                              
                              const prevTop = getTimePosition(prevItem.start_time, timelineStart, timelineEnd, timelineHeight);
                              const prevHeight = getDurationHeight(prevItem.start_time, prevItem.end_time, timelineStart, timelineEnd, timelineHeight);
                              const prevKey = `${selectedDay.date}-${prevItem.originalIndex}`;
                              const prevExpanded = expandedActivityCards.has(prevKey);
                              
                              // Use expanded height if card is expanded, otherwise use minimum
                              const prevActualHeight = prevExpanded ? Math.max(minHeight, prevHeight) + 8 : minHeight + 8;
                              const prevBottom = prevTop + prevActualHeight;
                              
                              if (prevBottom > previousBottom) {
                                previousBottom = prevBottom;
                              }
                              
                              // If this card would overlap with previous card, adjust its position
                              if (top < prevBottom && top > prevTop) {
                                adjustedTop = prevBottom;
                              }
                            }
                            
                            return (
                              <View
                                key={`${selectedDay.date}-${idx}`}
                                style={{
                                  position: 'absolute',
                                  top: Math.max(0, adjustedTop),
                                  left: 0,
                                  right: 0,
                                  marginBottom: 8, // Add spacing between cards
                                  minHeight: isExpanded ? Math.max(minHeight, height) : minHeight,
                                  zIndex: isExpanded ? 100 : (idx + 1),
                                  elevation: isExpanded ? 10 : (idx + 1), // For Android shadow/elevation
                                }}
                              >
                  <TouchableOpacity
                    onPress={() => {
                                    setExpandedActivityCards(prev => {
                                      const newSet = new Set<string>();
                                      // Only allow one card expanded at a time
                                      if (!prev.has(itemKey)) {
                                        newSet.add(itemKey);
                                      }
                                      return newSet;
                                    });
                                  }}
                                  activeOpacity={0.7}
                                >
                                  <View 
                                    className="p-3 rounded-lg bg-white border-2 shadow-sm"
                                    style={{
                                      borderLeftWidth: 4,
                                      borderLeftColor: '#0B2545', // Match Start Tracking button color
                                    }}
                                  >
                                    {/* Place Photo - Always visible by default */}
                                    {item.photoUrl && (
                                      <View className="mb-2 rounded-lg overflow-hidden">
                                        <Image 
                                          source={{ uri: item.photoUrl }} 
                                          style={{ width: '100%', height: 80 }} 
                                          resizeMode="cover"
                                        />
                </View>
                                    )}
                                    
                                    {/* Compact View - Always visible */}
                                    <View className="flex-row items-center justify-between">
                                      <View className="flex-1">
                                        {/* Time Display */}
                                        <Text className="text-sm font-rubik-bold text-primary-100">
                              {item.start_time} - {item.end_time}
                            </Text>
                                        {/* Activity Name */}
                                        <Text className="text-base font-rubik-bold text-gray-900" numberOfLines={1}>
                                          {item.name}
                            </Text>
                          </View>
                                      {/* Expand/Collapse Indicator */}
                                      <Text className="text-xs text-gray-400 ml-2">
                                        {isExpanded ? '▼' : '▶'}
                            </Text>
                        </View>
                                    
                                    {/* Expanded View - Show details when expanded */}
                                    {isExpanded && (
                                      <View className="mt-3">
                        
                        <Text className="text-sm text-gray-600 capitalize mb-1">
                          {item.category ?? "activity"}
                        </Text>
                        
                        {item.estimated_duration != null && (
                                          <Text className="text-xs text-gray-500 mb-1">
                              Duration: {typeof item.estimated_duration === "number"
                              ? formatDuration(item.estimated_duration)
                              : item.estimated_duration}
                          </Text>
                        )}
                        
                                        {/* Transport Information - Collapsible */}
                                        {(item.travel_time_minutes != null && item.travel_time_minutes > 0) || item.travel_instructions ? (
                                          <View className="mt-2 mb-1">
                                            <TouchableOpacity
                                              onPress={(e) => {
                                                e.stopPropagation();
                                                const itemKey = `${selectedDay.date}-${item.originalIndex}`;
                                                setExpandedTransport(prev => {
                                                  const newSet = new Set(prev);
                                                  if (newSet.has(itemKey)) {
                                                    newSet.delete(itemKey);
                                                  } else {
                                                    newSet.add(itemKey);
                                                  }
                                                  return newSet;
                                                });
                                              }}
                                              className="flex-row items-center"
                                            >
                                              <Text className="text-sm font-rubik-semibold text-gray-700 mr-2">
                                                Transport
                                              </Text>
                                              <Text className="text-xs text-gray-500">
                                                {expandedTransport.has(`${selectedDay.date}-${item.originalIndex}`) ? '▼' : '▶'}
                                              </Text>
                                            </TouchableOpacity>
                                            
                                            {expandedTransport.has(`${selectedDay.date}-${item.originalIndex}`) && (
                                              <View className="mt-2 ml-2 pl-2 border-l-2 border-gray-200">
                        {item.travel_time_minutes != null && item.travel_time_minutes > 0 && (
                                                  <Text className="text-xs text-gray-600 mb-1">
                              Transit: {item.travel_time_minutes} min
                          </Text>
                        )}
                        
                        {item.travel_instructions && (
                                                  <Text className="text-xs text-gray-600">
                            {item.travel_instructions}
                          </Text>
                        )}
                                              </View>
                                            )}
                                          </View>
                                        ) : null}
                                        
                                        {/* Extract food suggestions and other reasons */}
                                        {(() => {
                                          const reason = item.reason || '';
                                          const itemKey = `${selectedDay.date}-${item.originalIndex}`;
                                          
                                          // Check for food suggestions (Lunch/Dinner)
                                          const hasFoodSuggestion = /(Lunch|Dinner)\s+suggestion/i.test(reason);
                                          const foodSuggestionMatch = reason.match(/💡\s*(Lunch|Dinner)\s+suggestion:.*?(?=\n\n|$)/is);
                                          const foodSuggestion = foodSuggestionMatch ? foodSuggestionMatch[0].replace(/💡\s*/g, '').trim() : null;
                                          
                                          // Get non-food reason (everything except food suggestions)
                                          let otherReason = reason;
                                          if (foodSuggestionMatch) {
                                            otherReason = reason.replace(foodSuggestionMatch[0], '').trim();
                                            // Clean up extra newlines
                                            otherReason = otherReason.replace(/\n\n+/g, '\n\n').trim();
                                          }
                                          
                                          return (
                                            <>
                                              {/* Food Suggestions Button */}
                                              {hasFoodSuggestion && foodSuggestion && (
                                                <View className="mt-2 mb-1">
                          <TouchableOpacity
                                                    onPress={(e) => {
                                                      e.stopPropagation();
                                                      setExpandedFood(prev => {
                                                        const newSet = new Set(prev);
                                                        if (newSet.has(itemKey)) {
                                                          newSet.delete(itemKey);
                                                        } else {
                                                          newSet.add(itemKey);
                                                        }
                                                        return newSet;
                                                      });
                                                    }}
                                                    className="flex-row items-center"
                                                  >
                                                    <Text className="text-sm font-rubik-semibold text-gray-700 mr-2">
                                                      Food Suggestions
                          </Text>
                                                    <Text className="text-xs text-gray-500">
                                                      {expandedFood.has(itemKey) ? '▼' : '▶'}
                                                    </Text>
                          </TouchableOpacity>
                                                  
                                                  {expandedFood.has(itemKey) && (
                                                    <View className="mt-2 ml-2 pl-2 border-l-2 border-orange-200">
                                                      <Text className="text-xs text-gray-600">
                                                        {foodSuggestion}
                                                      </Text>
                        </View>
                                                  )}
                      </View>
                                              )}
                                              
                                              {/* Reason Button (for non-food reasons) */}
                                              {otherReason && (
                                                <View className="mt-2 mb-1">
                                                  <TouchableOpacity
                                                    onPress={(e) => {
                                                      e.stopPropagation();
                                                      setExpandedReason(prev => {
                                                        const newSet = new Set(prev);
                                                        if (newSet.has(itemKey)) {
                                                          newSet.delete(itemKey);
                                                        } else {
                                                          newSet.add(itemKey);
                                                        }
                                                        return newSet;
                                                      });
                                                    }}
                                                    className="flex-row items-center"
                                                  >
                                                    <Text className="text-sm font-rubik-semibold text-gray-700 mr-2">
                                                      Reason
                                                    </Text>
                                                    <Text className="text-xs text-gray-500">
                                                      {expandedReason.has(itemKey) ? '▼' : '▶'}
                                                    </Text>
                                                  </TouchableOpacity>
                                                  
                                                  {expandedReason.has(itemKey) && (
                                                    <View className="mt-2 ml-2 pl-2 border-l-2 border-gray-200">
                                                      <Text className="text-xs text-gray-600 italic">
                                                        {otherReason}
                      </Text>
                    </View>
                  )}
                </View>
                                              )}
                                            </>
                                          );
                                        })()}

                        {/* Personalize: Replace action */}
                                        <View className="mt-2">
                          <TouchableOpacity
                                            onPress={(e) => {
                                              e.stopPropagation();
                                              handleReplaceMultiDayItem(selectedDayIndex, item.originalIndex);
                                            }}
                                            className="px-3 py-1.5 rounded bg-primary-100 self-start"
                          >
                            <Text className="text-white text-xs font-rubik-semibold">Replace</Text>
                          </TouchableOpacity>
                        </View>

                        {/* Replacement Suggestions - Inline in the card */}
                        {replaceContext && 
                         replaceContext.dayIndex === selectedDayIndex && 
                         replaceContext.itemIndex === item.originalIndex && 
                         Array.isArray(replacementSuggestions) && (
                          <View className="mt-3 p-3 rounded-xl bg-gray-50 border border-gray-200">
                            <View className="flex-row justify-between items-center mb-2">
                              <Text className="text-sm font-rubik-bold text-gray-900">Choose a replacement</Text>
                              <TouchableOpacity onPress={cancelReplacement} className="px-2 py-1 rounded bg-gray-200">
                      <Text className="text-gray-700 text-xs font-rubik-semibold">Close</Text>
                    </TouchableOpacity>
                  </View>
                            <View className="flex-row flex-wrap justify-between gap-2">
                    {replacementSuggestions.map((p: any) => (
                      <TouchableOpacity
                        key={p.place_id}
                                  onPress={(e) => {
                                    e.stopPropagation();
                                    applyReplacementSelection(replaceContext.dayIndex, replaceContext.itemIndex, p);
                                  }}
                                  style={{ width: '48%', marginBottom: 8 }}
                                  className="rounded-lg overflow-hidden border border-gray-200 bg-white"
                      >
                        {p.photoUrl ? (
                          <View>
                                      <Image source={{ uri: p.photoUrl }} style={{ width: '100%', height: 80 }} resizeMode="cover" />
                          </View>
                        ) : (
                                    <View className="w-full h-20 bg-gray-100 items-center justify-center">
                            <Text className="text-gray-500 text-xs">No Image</Text>
                          </View>
                        )}
                                  <View className="p-2 bg-white">
                                    <Text className="font-rubik-semibold text-xs" numberOfLines={2}>{p.name}</Text>
                                    <Text className="text-gray-600 text-xs mt-0.5" numberOfLines={1}>{p.vicinity}</Text>
                                    {p.rating && (
                                      <Text className="text-gray-600 text-xs mt-0.5">⭐ {p.rating}</Text>
                                    )}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })() : (
                    <View className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                      <Text className="text-gray-500 text-center font-rubik-semibold">
                        No activities planned for this day
                      </Text>
                    </View>
                  )}
                </View>
              );
            })()}
            </View>
          )}
        </>
      </ScrollView>
    </View>
  );
}
