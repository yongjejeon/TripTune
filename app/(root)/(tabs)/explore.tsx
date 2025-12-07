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
import { checkWeatherForOutdoorActivities, BAD_WEATHER } from "@/lib/weatherAware";
import { calculateRestRecoveryByType, type UserProfile } from "@/lib/fatigueCalculator";
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
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, { Marker, Polyline } from "react-native-maps";
import { useCustomAlert } from "@/components/CustomAlert";

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
  return 22 * 60; // 10:00 PM (22:00) - Extended to prevent cutting off activities at 9 PM
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
    return [];
  }
  
  const coordinates = itinerary
    .filter(item => {
      return item.coordinates && item.coordinates.lat && item.coordinates.lng;
    })
    .map(item => ({
      latitude: item.coordinates.lat,
      longitude: item.coordinates.lng,
      title: item.name,
      description: `${item.start_time} - ${item.end_time}`,
      category: item.category
    }));
  
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
  // Custom alert
  const { showAlert, AlertComponent } = useCustomAlert();
  
  const [loading, setLoading] = useState(false);

  const [optimizedResult, setOptimizedResult] = useState<any>(null);
  const [tripPlan, setTripPlan] = useState<any | null>(null);
  const [weatherAdaptedResult, setWeatherAdaptedResult] = useState<any>(null);

  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [currentWeather, setCurrentWeather] = useState<any>(null);
  const [currentTimeDisplay, setCurrentTimeDisplay] = useState<string>("");
  const [currentTimeWithOverride, setCurrentTimeWithOverride] = useState<Date>(new Date());
  const [lastWeatherAlertCheck, setLastWeatherAlertCheck] = useState<number>(0);
  
  // Update current time display (with override support)
  useEffect(() => {
    const updateTimeDisplay = async () => {
      try {
        const testOverride = await AsyncStorage.getItem("testTimeOverride");
        let date: Date;
        let isOverride = false;
        
        if (testOverride) {
          const data = JSON.parse(testOverride);
          date = new Date(data.timestamp);
          isOverride = true;
        } else {
          date = new Date();
        }
        
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        const timeStr = `${displayHours}:${String(minutes).padStart(2, '0')} ${ampm}`;
        
        setCurrentTimeDisplay(isOverride ? `Time: ${timeStr} (override)` : `Time: ${timeStr}`);
        setCurrentTimeWithOverride(date); // Update current time state for synchronous checks
      } catch (error) {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        setCurrentTimeDisplay(`Time: ${displayHours}:${String(minutes).padStart(2, '0')} ${ampm}`);
        setCurrentTimeWithOverride(now);
      }
    };
    
    updateTimeDisplay();
    const interval = setInterval(updateTimeDisplay, 1000); // Update every second
    return () => clearInterval(interval);
  }, [isTracking]);
  
  // Monitor user location when tracking
  const locationSubscriptionRef = useRef<any>(null);
  const lastOverrideStateRef = useRef<string | null>(null);
  
  useEffect(() => {
    console.log("[Location] ===== LOCATION MONITORING useEffect TRIGGERED =====");
    console.log("[Location] useEffect - isTracking:", isTracking);
    
    if (!isTracking) {
      console.log("[Location] useEffect - Not tracking, stopping location monitoring");
      // Stop location monitoring when tracking stops
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
      }
      return;
    }
    
    const startLocationMonitoring = async () => {
      console.log("[Location] ===== startLocationMonitoring() called =====");
      try {
        // Check for test override first
        const testOverride = await AsyncStorage.getItem("testLocationOverride");
        console.log("[Location] startLocationMonitoring - testOverride check:", testOverride ? "EXISTS" : "NOT FOUND");
        
        if (testOverride) {
          const location = JSON.parse(testOverride);
          console.log("[Location] startLocationMonitoring - Override found, setting location:", location);
          setUserLocation(location);
          console.log("[Location] Using test override:", location);
          lastOverrideStateRef.current = testOverride;
          console.log("[Location] startLocationMonitoring - lastOverrideStateRef set to:", testOverride);
          
          // Stop GPS if it's running
          if (locationSubscriptionRef.current) {
            console.log("[Location] startLocationMonitoring - Stopping GPS subscription");
            // Clear heartbeat if it exists
            const heartbeat = (locationSubscriptionRef.current as any)?._heartbeatInterval;
            if (heartbeat) {
              clearInterval(heartbeat);
              console.log("[Location] startLocationMonitoring - Cleared GPS heartbeat (override active)");
            }
            locationSubscriptionRef.current.remove();
            locationSubscriptionRef.current = null;
          }
          return;
        }
        
        console.log("[Location] startLocationMonitoring - No override, starting GPS...");
        
        // Stop any existing GPS subscription before starting a new one
        if (locationSubscriptionRef.current) {
          console.log("[Location] startLocationMonitoring - Cleaning up existing GPS subscription");
          // Clear heartbeat if it exists
          const heartbeat = (locationSubscriptionRef.current as any)?._heartbeatInterval;
          if (heartbeat) {
            clearInterval(heartbeat);
            console.log("[Location] startLocationMonitoring - Cleared existing GPS heartbeat");
          }
          locationSubscriptionRef.current.remove();
          locationSubscriptionRef.current = null;
        }
        
        // Request location permissions
        const { status } = await Location.requestForegroundPermissionsAsync();
        console.log("[Location] startLocationMonitoring - Permission status:", status);
        if (status !== 'granted') {
          console.log("[Location] startLocationMonitoring - Permission DENIED");
          showAlert("Location Permission", "Location permission is required for tracking");
          return;
        }
        
        // Get initial location
        console.log("[Location] startLocationMonitoring - Getting current position...");
        const initialLocation = await Location.getCurrentPositionAsync({});
        const initialLoc = {
          lat: initialLocation.coords.latitude,
          lng: initialLocation.coords.longitude
        };
        console.log("[Location] startLocationMonitoring - Got initial location:", initialLoc);
        setUserLocation(initialLoc);
        console.log("[Location] startLocationMonitoring - userLocation state updated");
        
        // Watch location updates (only if no override)
        const hasOverride = await AsyncStorage.getItem("testLocationOverride");
        console.log("[Location] startLocationMonitoring - Final override check before watching:", hasOverride ? "EXISTS" : "NOT FOUND");
        if (!hasOverride) {
          console.log("[Location] startLocationMonitoring - Starting watchPositionAsync...");
          console.log("[Location] GPS config: timeInterval=5000ms, distanceInterval=10m, accuracy=Balanced");
          locationSubscriptionRef.current = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.Balanced,
              timeInterval: 5000, // Update every 5 seconds (minimum update interval)
              distanceInterval: 0, // Update on any movement (0 = always update based on timeInterval)
            },
            async (location) => {
              console.log("[Location] ===== GPS CALLBACK TRIGGERED =====");
              console.log("[Location] GPS callback - Raw location:", {
                lat: location.coords.latitude,
                lng: location.coords.longitude,
                accuracy: location.coords.accuracy,
                timestamp: new Date(location.timestamp).toISOString()
              });
              
              // Double-check override wasn't set during callback
              const checkOverride = await AsyncStorage.getItem("testLocationOverride");
              console.log("[Location] GPS callback - Override check:", checkOverride ? "EXISTS (will ignore)" : "NOT FOUND (will use GPS)");
              
              if (!checkOverride) {
                const newLoc = {
                  lat: location.coords.latitude,
                  lng: location.coords.longitude
                };
                console.log("[Location] GPS callback - Setting userLocation to:", newLoc);
                setUserLocation(newLoc);
                console.log("[Location] GPS callback - userLocation state updated");
              } else {
                console.log("[Location] GPS callback - Update ignored because override exists");
              }
              console.log("[Location] ===== GPS CALLBACK COMPLETE =====");
            }
          );
          console.log("[Location] startLocationMonitoring - watchPositionAsync started successfully");
          console.log("[Location] Subscription ref is:", locationSubscriptionRef.current !== null ? "NOT NULL" : "NULL");
          console.log("[Location] GPS should now be providing updates every 5 seconds");
          
          // Add a periodic heartbeat to verify GPS subscription is active
          const gpsHeartbeat = setInterval(() => {
            if (locationSubscriptionRef.current) {
              console.log("[Location] GPS heartbeat - Subscription is active, waiting for updates...");
              // Also try to get current position as a fallback
              Location.getCurrentPositionAsync({}).then((pos) => {
                console.log("[Location] GPS heartbeat - Current position check:", {
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude,
                  timestamp: new Date(pos.timestamp).toISOString()
                });
              }).catch((err) => {
                console.error("[Location] GPS heartbeat - Failed to get current position:", err);
              });
            } else {
              console.warn("[Location] GPS heartbeat - Subscription ref is NULL! GPS may have stopped.");
              clearInterval(gpsHeartbeat);
            }
          }, 30000); // Every 30 seconds
          
          // Store heartbeat interval ID for cleanup
          (locationSubscriptionRef.current as any)._heartbeatInterval = gpsHeartbeat;
        }
      } catch (error) {
        console.error("[Location] Failed to start monitoring:", error);
      }
      console.log("[Location] ===== startLocationMonitoring() complete =====");
    };
    
    startLocationMonitoring();
    
    // Check for test override changes every 1 second for more responsive updates
    const checkOverride = setInterval(async () => {
      const testOverride = await AsyncStorage.getItem("testLocationOverride");
      const lastState = lastOverrideStateRef.current;
      
      console.log("[Location] Interval check - testOverride:", testOverride ? "EXISTS" : "NOT FOUND");
      console.log("[Location] Interval check - lastOverrideStateRef:", lastState);
      
      if (testOverride && testOverride !== lastState) {
        // New override applied - stop GPS and use override
        try {
          const location = JSON.parse(testOverride);
          console.log("[Location Override] ===== NEW OVERRIDE DETECTED =====");
          console.log("[Location Override] Raw testOverride string:", testOverride);
          console.log("[Location Override] Parsed location:", location);
          console.log("[Location Override] Location lat:", location?.lat, "lng:", location?.lng);
          console.log("[Location Override] Previous state:", lastState);
          
          if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
            console.error("[Location Override] ERROR: Invalid location object:", location);
          } else {
            // Stop GPS monitoring when override is active
            if (locationSubscriptionRef.current) {
              console.log("[Location Override] Stopping GPS subscription");
              // Clear heartbeat if it exists
              const heartbeat = (locationSubscriptionRef.current as any)?._heartbeatInterval;
              if (heartbeat) {
                clearInterval(heartbeat);
                console.log("[Location Override] Cleared GPS heartbeat");
              }
              locationSubscriptionRef.current.remove();
              locationSubscriptionRef.current = null;
            } else {
              console.log("[Location Override] No GPS subscription to stop");
            }
            
            console.log("[Location Override] Calling setUserLocation with:", location);
            setUserLocation(location);
            console.log("[Location Override] setUserLocation called - state should update soon");
            lastOverrideStateRef.current = testOverride;
            console.log("[Location Override] lastOverrideStateRef updated to:", testOverride);
          }
        } catch (parseError) {
          console.error("[Location Override] ERROR parsing testOverride:", parseError);
          console.error("[Location Override] Raw string that failed:", testOverride);
        }
      } else if (!testOverride && lastState !== null) {
        // Override was cleared - restart GPS monitoring
        console.log("[Location] ===== OVERRIDE CLEARED =====");
        console.log("[Location] Override cleared, restarting GPS...");
        console.log("[Location] Previous override state was:", lastState);
        lastOverrideStateRef.current = null;
        
        // Remove the cleared flag
        await AsyncStorage.removeItem("testLocationCleared");
        console.log("[Location] Cleared testLocationCleared flag");
        
        // Restart GPS monitoring
        console.log("[Location] Calling startLocationMonitoring() to restart GPS...");
        await startLocationMonitoring();
      } else if (testOverride && testOverride === lastState) {
        // Override is still active, make sure GPS is stopped and location is set
        try {
          const location = JSON.parse(testOverride);
          console.log("[Location] Interval check - Override still active, ensuring location is set:", location);
          console.log("[Location] Interval check - Current userLocation state:", userLocation);
          console.log("[Location] Interval check - Should be same? Comparing...");
          
          // Only update if the location is actually different
          if (!userLocation || userLocation.lat !== location.lat || userLocation.lng !== location.lng) {
            console.log("[Location] Interval check - Location mismatch detected! Updating state...");
            console.log("[Location] Interval check - Old:", userLocation, "New:", location);
            setUserLocation(location);
          } else {
            console.log("[Location] Interval check - Location already matches, no update needed");
          }
          
          if (locationSubscriptionRef.current) {
            console.log("[Location] Interval check - Stopping GPS (should already be stopped)");
            // Clear heartbeat if it exists
            const heartbeat = (locationSubscriptionRef.current as any)?._heartbeatInterval;
            if (heartbeat) {
              clearInterval(heartbeat);
              console.log("[Location] Interval check - Cleared GPS heartbeat");
            }
            locationSubscriptionRef.current.remove();
            locationSubscriptionRef.current = null;
          }
        } catch (parseError) {
          console.error("[Location] Interval check - ERROR parsing override:", parseError);
        }
      } else {
        console.log("[Location] Interval check - No change (no override, no previous state)");
      }
    }, 1000); // Check every second for faster response
    
    return () => {
      console.log("[Location] ===== LOCATION MONITORING useEffect CLEANUP =====");
      if (locationSubscriptionRef.current) {
        console.log("[Location] Cleanup - Removing GPS subscription");
        // Clear heartbeat if it exists
        const heartbeat = (locationSubscriptionRef.current as any)?._heartbeatInterval;
        if (heartbeat) {
          clearInterval(heartbeat);
          console.log("[Location] Cleanup - Cleared GPS heartbeat interval");
        }
        locationSubscriptionRef.current.remove();
        locationSubscriptionRef.current = null;
      }
      console.log("[Location] Cleanup - Clearing interval");
      clearInterval(checkOverride);
      console.log("[Location] ===== CLEANUP COMPLETE =====");
    };
  }, [isTracking]);
  
  // Track userLocation state changes for debugging
  useEffect(() => {
    console.log("[Location] ===== userLocation STATE CHANGED =====");
    console.log("[Location] New userLocation:", userLocation);
    console.log("[Location] ===== userLocation STATE CHANGE COMPLETE =====");
  }, [userLocation]);
  
  // Track optimizedResult state changes for debugging
  useEffect(() => {
    console.log("[Itinerary] ===== optimizedResult STATE CHANGED =====");
    if (optimizedResult) {
      console.log("[Itinerary] optimizedResult exists");
      console.log("[Itinerary] Has itinerary:", !!optimizedResult.itinerary);
      if (optimizedResult.itinerary) {
        console.log("[Itinerary] Number of activities:", optimizedResult.itinerary.length);
        optimizedResult.itinerary.forEach((item: any, idx: number) => {
          console.log(`[Itinerary] Activity ${idx + 1}: ${item.name} (${item.start_time || 'no time'} - ${item.end_time || 'no time'})`);
        });
      }
    } else {
      console.log("[Itinerary] optimizedResult is NULL");
    }
    console.log("[Itinerary] ===== optimizedResult STATE CHANGE COMPLETE =====");
  }, [optimizedResult]);
  
  // Track weatherAdaptedResult state changes for debugging
  useEffect(() => {
    console.log("[Itinerary] ===== weatherAdaptedResult STATE CHANGED =====");
    if (weatherAdaptedResult) {
      console.log("[Itinerary] weatherAdaptedResult exists");
      console.log("[Itinerary] Has itinerary:", !!weatherAdaptedResult.itinerary);
      if (weatherAdaptedResult.itinerary) {
        console.log("[Itinerary] Number of activities:", weatherAdaptedResult.itinerary.length);
        weatherAdaptedResult.itinerary.forEach((item: any, idx: number) => {
          console.log(`[Itinerary] Activity ${idx + 1}: ${item.name} (${item.start_time || 'no time'} - ${item.end_time || 'no time'})`);
          if (item.adaptationReason) {
            console.log(`[Itinerary] Weather adaptation: ${item.adaptationReason}`);
          }
        });
      }
    } else {
      console.log("[Itinerary] weatherAdaptedResult is NULL");
    }
    console.log("[Itinerary] ===== weatherAdaptedResult STATE CHANGE COMPLETE =====");
  }, [weatherAdaptedResult]);
  
  // Track tripPlan state changes for debugging
  useEffect(() => {
    console.log("[Itinerary] ===== tripPlan STATE CHANGED =====");
    if (tripPlan) {
      console.log("[Itinerary] tripPlan exists");
      console.log("[Itinerary] Number of days:", tripPlan.days?.length || 0);
      console.log("[Itinerary] Start date:", tripPlan.startDate);
      console.log("[Itinerary] End date:", tripPlan.endDate);
      if (tripPlan.days) {
        tripPlan.days.forEach((day: any, dayIdx: number) => {
          console.log(`[Itinerary] Day ${dayIdx + 1} (${day.date}): ${day.itinerary?.length || 0} activities`);
          if (day.itinerary) {
            day.itinerary.forEach((item: any, idx: number) => {
              console.log(`[Itinerary] Day ${dayIdx + 1}, Activity ${idx + 1}: ${item.name} (${item.start_time || 'no time'} - ${item.end_time || 'no time'})`);
            });
          }
        });
      }
    } else {
      console.log("[Itinerary] tripPlan is NULL");
    }
    console.log("[Itinerary] ===== tripPlan STATE CHANGE COMPLETE =====");
  }, [tripPlan]);
  
  // Check location override when screen is focused (e.g., returning from Testing tab)
  useFocusEffect(
    useCallback(() => {
      console.log("[Location] ===== useFocusEffect triggered =====");
      console.log("[Location] Focus effect - isTracking:", isTracking);
      
      const checkOverrideOnFocus = async () => {
        console.log("[Location] Focus effect - Checking override...");
        const testOverride = await AsyncStorage.getItem("testLocationOverride");
        console.log("[Location] Focus effect - testOverride:", testOverride ? "EXISTS" : "NOT FOUND");
        console.log("[Location] Focus effect - lastOverrideStateRef.current:", lastOverrideStateRef.current);
        
        if (testOverride) {
          // Override exists - apply it (regardless of tracking status)
          try {
            const location = JSON.parse(testOverride);
            console.log("[Location] Focus effect - ===== OVERRIDE FOUND, APPLYING =====");
            console.log("[Location Override] Applied on focus:", location);
            console.log("[Location Override] Location lat:", location?.lat, "lng:", location?.lng);
            
            if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
              console.error("[Location] Focus effect - ERROR: Invalid location object:", location);
            } else {
              // Stop GPS if running
              if (locationSubscriptionRef.current) {
                console.log("[Location] Focus effect - Stopping GPS subscription");
                // Clear heartbeat if it exists
                const heartbeat = (locationSubscriptionRef.current as any)?._heartbeatInterval;
                if (heartbeat) {
                  clearInterval(heartbeat);
                  console.log("[Location] Focus effect - Cleared GPS heartbeat");
                }
                locationSubscriptionRef.current.remove();
                locationSubscriptionRef.current = null;
              } else {
                console.log("[Location] Focus effect - No GPS subscription to stop");
              }
              
              console.log("[Location] Focus effect - Setting userLocation to:", location);
              console.log("[Location] Focus effect - Current userLocation state:", userLocation);
              setUserLocation(location);
              lastOverrideStateRef.current = testOverride;
              console.log("[Location] Focus effect - lastOverrideStateRef updated to:", testOverride);
            }
          } catch (parseError) {
            console.error("[Location] Focus effect - ERROR parsing override:", parseError);
          }
        } else if (lastOverrideStateRef.current !== null) {
          // Override was cleared - restart GPS
          console.log("[Location] Focus effect - ===== OVERRIDE WAS CLEARED =====");
          console.log("[Location] Override cleared on focus, restarting GPS...");
          lastOverrideStateRef.current = null;
          
          // Remove cleared flag
          await AsyncStorage.removeItem("testLocationCleared");
          console.log("[Location] Focus effect - Removed testLocationCleared flag");
          
          // Restart GPS monitoring
          try {
            // Stop any existing subscription
            if (locationSubscriptionRef.current) {
              console.log("[Location] Focus effect - Cleaning up existing GPS subscription");
              locationSubscriptionRef.current.remove();
              locationSubscriptionRef.current = null;
            }
            
            // Request permissions
            console.log("[Location] Focus effect - Requesting permissions...");
            const { status } = await Location.requestForegroundPermissionsAsync();
            console.log("[Location] Focus effect - Permission status:", status);
            if (status !== 'granted') {
              console.log("[Location] Focus effect - Permission denied");
              return;
            }
            
            // Get current location
            console.log("[Location] Focus effect - Getting current position...");
            const initialLocation = await Location.getCurrentPositionAsync({});
            const initialLoc = {
              lat: initialLocation.coords.latitude,
              lng: initialLocation.coords.longitude
            };
            console.log("[Location] Focus effect - Got location:", initialLoc);
            setUserLocation(initialLoc);
            
            // Start watching
            console.log("[Location] Focus effect - Starting watchPositionAsync...");
            locationSubscriptionRef.current = await Location.watchPositionAsync(
              {
                accuracy: Location.Accuracy.Balanced,
                timeInterval: 5000,
                distanceInterval: 10,
              },
              async (location) => {
                const checkOverride = await AsyncStorage.getItem("testLocationOverride");
                if (!checkOverride) {
                  const newLoc = {
                    lat: location.coords.latitude,
                    lng: location.coords.longitude
                  };
                  console.log("[Location] Focus effect - GPS update:", newLoc);
                  setUserLocation(newLoc);
                } else {
                  console.log("[Location] Focus effect - GPS update ignored, override exists");
                }
              }
            );
            console.log("[Location] Focus effect - watchPositionAsync started");
          } catch (error) {
            console.error("[Location] Failed to restart monitoring on focus:", error);
          }
        } else {
          console.log("[Location] Focus effect - No override, no previous state, no action needed");
        }
        console.log("[Location] ===== useFocusEffect complete =====");
      };
      
      checkOverrideOnFocus();
    }, [isTracking, userLocation])
  );
  
  // Always check for location overrides, independent of tracking status
  useEffect(() => {
    console.log("[Location] ===== ALWAYS-CHECK OVERRIDE useEffect triggered =====");
    
    const checkOverrideAlways = async () => {
      const testOverride = await AsyncStorage.getItem("testLocationOverride");
      console.log("[Location] Always-check - testOverride:", testOverride ? "EXISTS" : "NOT FOUND");
      
      if (testOverride) {
        try {
          const location = JSON.parse(testOverride);
          const currentLocationStr = lastOverrideStateRef.current;
          
          // Only update if the override has changed
          if (testOverride !== currentLocationStr) {
            console.log("[Location] Always-check - ===== NEW OVERRIDE DETECTED (always-check) =====");
            console.log("[Location] Always-check - New location:", location);
            console.log("[Location] Always-check - Previous:", currentLocationStr);
            
            if (location && typeof location.lat === 'number' && typeof location.lng === 'number') {
              // Stop GPS if running
              if (locationSubscriptionRef.current) {
                console.log("[Location] Always-check - Stopping GPS");
                const heartbeat = (locationSubscriptionRef.current as any)?._heartbeatInterval;
                if (heartbeat) clearInterval(heartbeat);
                locationSubscriptionRef.current.remove();
                locationSubscriptionRef.current = null;
              }
              
              console.log("[Location] Always-check - Updating userLocation state");
              setUserLocation(location);
              lastOverrideStateRef.current = testOverride;
            }
          } else if (!userLocation || userLocation.lat !== location.lat || userLocation.lng !== location.lng) {
            // Override hasn't changed, but state doesn't match - sync it
            console.log("[Location] Always-check - Override unchanged but state mismatch - syncing");
            console.log("[Location] Always-check - Current state:", userLocation);
            console.log("[Location] Always-check - Override value:", location);
            setUserLocation(location);
          }
        } catch (error) {
          console.error("[Location] Always-check - ERROR:", error);
        }
      } else if (lastOverrideStateRef.current !== null) {
        // Override was cleared
        console.log("[Location] Always-check - Override cleared");
        lastOverrideStateRef.current = null;
      }
    };
    
    // Check immediately
    checkOverrideAlways();
    
    // Also set up interval to check periodically
    const interval = setInterval(checkOverrideAlways, 2000); // Check every 2 seconds
    
    return () => {
      console.log("[Location] Always-check - Cleaning up interval");
      clearInterval(interval);
    };
  }, []); // Run once on mount, then rely on interval
  
  // Fetch weather data (checks test overrides frequently for testing)
  useEffect(() => {
    if (!isTracking || !userLocation) return;
    
    const fetchWeather = async () => {
      try {
        // Check for test override first
        const testOverride = await AsyncStorage.getItem("testWeatherOverride");
        if (testOverride) {
          setCurrentWeather(JSON.parse(testOverride));
          setLastWeatherCheck(Date.now());
          return;
        }
        
        // Fetch real weather
        const { getWeather } = await import("@/lib/weather");
        const condition = await getWeather(userLocation.lat, userLocation.lng);
        
        if (condition) {
          // Fetch full weather data for temperature and humidity
          const API_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_KEY;
          const axios = (await import("axios")).default;
          const res = await axios.get(
            'https://api.openweathermap.org/data/2.5/weather',
            {
              params: {
                lat: userLocation.lat,
                lon: userLocation.lng,
                appid: API_KEY,
                units: 'metric',
              },
            }
          );
          
          setCurrentWeather({
            condition,
            temperature: Math.round(res.data.main.temp),
            humidity: res.data.main.humidity
          });
          setLastWeatherCheck(Date.now());
        }
      } catch (error) {
        console.error("[Weather] Failed to fetch:", error);
      }
    };
    
    fetchWeather();
    // Check for test overrides every 2 seconds, fetch real weather every 10 minutes
    const quickCheck = setInterval(fetchWeather, 2000); // Check overrides frequently
    return () => clearInterval(quickCheck);
  }, [isTracking, userLocation]);
  const [currentActivityIdx, setCurrentActivityIdx] = useState<number | null>(null);
  const [scheduleStatus, setScheduleStatus] = useState<any>(null);
  const [scheduleAdjustments, setScheduleAdjustments] = useState<any[]>([]);
  const [lastWeatherCheck, setLastWeatherCheck] = useState<number>(0);
  const [lastScheduleCheck, setLastScheduleCheck] = useState<number>(0);
  const [currentTripDayIndex, setCurrentTripDayIndex] = useState<number | null>(null);
  const [lastDateNotice, setLastDateNotice] = useState<number>(0);
  const [replaceContext, setReplaceContext] = useState<{ dayIndex: number; itemIndex: number } | null>(null);
  const [replacementSuggestions, setReplacementSuggestions] = useState<any[] | null>(null);
  const [currentFatigueData, setCurrentFatigueData] = useState<any>(null);
  const [lastFatigueCheck, setLastFatigueCheck] = useState<number>(0);
  
  // Activity completion auto-detection tracking
  const wasAtActivityRef = useRef<{ [key: number]: boolean }>({}); // Track if user was at each activity
  const hasLeftActivityRef = useRef<{ [key: number]: boolean }>({}); // Track if user left each activity
  const completionPromptCooldownRef = useRef<{ [key: number]: number }>({}); // Track cooldown per activity
  
  // Activity completion tracking
  interface ActivityStatus {
    activityIndex: number;
    status: 'pending' | 'in-progress' | 'completed' | 'skipped';
    arrivedAt?: string;
    completedAt?: string;
    durationMinutes?: number;
    expectedDuration?: number; // Expected duration in minutes
  }
  
  const [activityStatuses, setActivityStatuses] = useState<ActivityStatus[]>([]);

  // Helper to get current time with test override support
  const getCurrentTime = async (): Promise<Date> => {
    try {
      const testOverride = await AsyncStorage.getItem("testTimeOverride");
      if (testOverride) {
        const data = JSON.parse(testOverride);
        return new Date(data.timestamp);
      }
    } catch (error) {
      console.error("[Time] Error checking override:", error);
    }
    return new Date();
  };

  // Load activity statuses for current day
  const loadActivityStatuses = async () => {
    if (!tripPlan || currentTripDayIndex === null) return;
    
    try {
      const key = `activityStatus_${tripPlan.startDate}_day${currentTripDayIndex}`;
      const data = await AsyncStorage.getItem(key);
      if (data) {
        const loaded = JSON.parse(data);
        setActivityStatuses(loaded);
      } else {
        setActivityStatuses([]);
      }
    } catch (error) {
      console.error("Failed to load activity statuses:", error);
    }
  };

  // Save activity statuses
  const saveActivityStatuses = async (statuses: ActivityStatus[]) => {
    if (!tripPlan || currentTripDayIndex === null) return;
    
    try {
      const key = `activityStatus_${tripPlan.startDate}_day${currentTripDayIndex}`;
      await AsyncStorage.setItem(key, JSON.stringify(statuses));
      setActivityStatuses(statuses);
    } catch (error) {
      console.error("Failed to save activity statuses:", error);
    }
  };

  // Mark activity as complete (or skipped)
  const markActivityComplete = async (activityIndex: number, wasSkipped: boolean = false) => {
    if (!tripPlan || currentTripDayIndex === null) return;
    
    try {
      const todayItinerary = tripPlan.days[currentTripDayIndex]?.itinerary || [];
      const activity = todayItinerary[activityIndex];
      const existingStatuses = [...activityStatuses];
      const existingStatus = existingStatuses.find(s => s.activityIndex === activityIndex);
      
      let durationMinutes = 0;
      if (existingStatus) {
        existingStatus.status = wasSkipped ? 'skipped' : 'completed';
        existingStatus.completedAt = new Date().toISOString();
        if (existingStatus.arrivedAt) {
          const arrived = new Date(existingStatus.arrivedAt);
          const completed = new Date();
          durationMinutes = Math.round((completed.getTime() - arrived.getTime()) / 60000);
          existingStatus.durationMinutes = durationMinutes;
        }
      } else {
        existingStatuses.push({
          activityIndex,
          status: wasSkipped ? 'skipped' : 'completed',
          completedAt: new Date().toISOString()
        });
      }
      
      await saveActivityStatuses(existingStatuses);
      
      // Update state to trigger re-render (important for progress bar update)
      setActivityStatuses(existingStatuses);
      
      // Clear completion detection tracking for this activity
      wasAtActivityRef.current[activityIndex] = false;
      hasLeftActivityRef.current[activityIndex] = false;
      
      // Apply fatigue recovery if this is a rest stop
      if (!wasSkipped && activity?.isRestStop && durationMinutes > 0 && currentFatigueData) {
        try {
          // Get user profile
          const bioData = await AsyncStorage.getItem("userBiometrics");
          if (bioData) {
            const bio = JSON.parse(bioData);
            const profile: UserProfile = {
              gender: bio.gender === "female" ? "female" : "male",
              age: Number(bio.age) || 30,
              weight: Number(bio.weight) || 70,
              height: Number(bio.height) || 170,
            };
            
            // Determine rest type from activity category or name
            const activityName = (activity.name || "").toLowerCase();
            const category = (activity.category || "").toLowerCase();
            let restType: 'cafe' | 'spa' | 'park' | 'hotel' = 'cafe';
            
            if (activityName.includes('spa') || category.includes('spa')) {
              restType = 'spa';
            } else if (activityName.includes('hotel') || category.includes('hotel') || activityName.includes('room')) {
              restType = 'hotel';
            } else if (activityName.includes('park') || category.includes('park') || category.includes('garden')) {
              restType = 'park';
            }
            
            // Calculate recovery
            const recovery = calculateRestRecoveryByType(
              currentFatigueData.percentage,
              durationMinutes,
              restType,
              'moderate', // Assume moderate activity before rest
              profile
            );
            
            // Update fatigue data
            const updatedFatigue = {
              ...currentFatigueData,
              percentage: recovery.newFatiguePercentage,
              totalEEToday: Math.max(0, currentFatigueData.totalEEToday - recovery.energySaved),
              budgetRemaining: currentFatigueData.budgetRemaining + recovery.energySaved,
            };
            
            // Save updated fatigue
            await AsyncStorage.setItem("currentFatigue", JSON.stringify(updatedFatigue));
            setCurrentFatigueData(updatedFatigue);
            
            // If fatigue is still high after rest, reset the last check time to allow immediate re-check
            // The useEffect will automatically re-run when currentFatigueData changes
            if (recovery.newFatiguePercentage >= 60) {
              console.log(`[Fatigue] After rest stop, fatigue still high (${recovery.newFatiguePercentage}%), will check again soon`);
              // Reset the last fatigue check to allow immediate re-check after a short delay
              setTimeout(() => {
                setLastFatigueCheck(Date.now() - 120000); // Allow check immediately (2 minutes ago)
              }, 3000); // Wait 3 seconds before allowing re-check
            } else {
              console.log(`[Fatigue] After rest stop, fatigue is now acceptable (${recovery.newFatiguePercentage}%)`);
            }
            
            // Show recovery message
            showAlert(
              "Rest Recovery",
              `You've recovered ${recovery.fatigueReduction}% fatigue!\n\n` +
              `Energy saved: ${recovery.energySaved} kcal\n` +
              `New fatigue level: ${recovery.newFatiguePercentage}%` +
              (recovery.newFatiguePercentage >= 60 ? `\n\nFatigue is still high. We'll check again shortly.` : ""),
              [{ text: "Great!" }]
            );
          }
        } catch (error) {
          console.error("[Recovery] Failed to apply recovery:", error);
        }
      }
      
      // Check if user completed early and adjust schedule
      if (!wasSkipped && existingStatus?.arrivedAt && existingStatus?.expectedDuration) {
        const timeSaved = existingStatus.expectedDuration - (existingStatus.durationMinutes || 0);
        if (timeSaved > 5) { // If saved more than 5 minutes
          adjustScheduleForEarlyCompletion(activityIndex, timeSaved);
        }
      }
      
      // Move to next activity
      if (activityIndex < todayItinerary.length - 1) {
        setCurrentActivityIdx(activityIndex + 1);
      } else {
        // All activities done for the day!
        showAlert(
          "Day Complete!",
          "You've finished all activities for today. Great job!",
          [{ text: "Awesome!" }]
        );
        setScheduleStatus({ status: "completed" });
      }
    } catch (error: any) {
      console.error("Failed to mark activity complete:", error);
      showAlert("Error", `Failed to mark activity as complete: ${error.message}`);
    }
  };

  // Adjust schedule when user completes activity early
  const adjustScheduleForEarlyCompletion = async (completedActivityIndex: number, minutesSaved: number) => {
    if (!tripPlan || currentTripDayIndex === null) return;
    
    try {
      console.log(`[Schedule] Activity ${completedActivityIndex} completed ${minutesSaved} minutes early`);
      
      showAlert(
        "Ahead of Schedule!",
        `You finished ${minutesSaved} minutes early. Would you like to start your next activity now?`,
        [
          {
            text: "Wait (stick to schedule)",
            style: "cancel",
            onPress: () => {
              console.log("[Schedule] User chose to wait");
            }
          },
          {
            text: "Start Next Activity",
            onPress: async () => {
              // Move to next activity immediately
              const nextIndex = completedActivityIndex + 1;
              const todayItinerary = tripPlan.days[currentTripDayIndex]?.itinerary || [];
              
              if (nextIndex < todayItinerary.length) {
                setCurrentActivityIdx(nextIndex);
                
                // Update status for next activity
                const updatedStatuses = [...activityStatuses];
                const nextStatus = updatedStatuses.find(s => s.activityIndex === nextIndex);
                
                if (nextStatus) {
                  nextStatus.arrivedAt = new Date().toISOString();
                  nextStatus.status = 'in-progress';
                } else {
                  updatedStatuses.push({
                    activityIndex: nextIndex,
                    status: 'in-progress',
                    arrivedAt: new Date().toISOString()
                  });
                }
                
                await saveActivityStatuses(updatedStatuses);
                
                showAlert(
                  "Schedule Updated",
                  `Starting "${todayItinerary[nextIndex].name}" now. Enjoy!`
                );
              }
            }
          }
        ]
      );
    } catch (error: any) {
      console.error("Failed to adjust schedule:", error);
    }
  };
  
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
        
        // Load tracking state
        const trackingState = await AsyncStorage.getItem("isTracking");
        if (trackingState === "true") {
          setIsTracking(true);
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
    
    showAlert(
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
              
              showAlert("Schedule Adjusted", "Added 15 minutes transition time and adjusted subsequent activities.");
            } catch (error) {
              console.error("Failed to allocate transition time:", error);
              showAlert("Error", "Failed to adjust schedule");
            }
          },
        },
        {
          text: "No",
          style: "cancel",
          onPress: async () => {
            // Ask if they want to change schedule based on current location
            showAlert(
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
                        showAlert("No Nearby Sites", "No suitable tourist sites found near your current location.");
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
                      
                      showAlert(
                        "Schedule Updated",
                        `Added "${nearestSite.name}" to your itinerary based on your current location.`
                      );
                    } catch (error) {
                      console.error("Failed to adjust itinerary for current location:", error);
                      showAlert("Error", "Failed to update schedule based on location");
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

    const runMonitoring = async () => {
      // Helper to format local date as YYYY-MM-DD
      const localDateString = async () => {
        const d = await getCurrentTime();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const da = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${da}`;
      };

      // Prefer multi-day plan for tracking
      if (tripPlan?.days?.length) {
        const today = await localDateString();
        const dayIdx = tripPlan.days.findIndex((d: any) => d.date === today);
      if (dayIdx === -1) {
        setCurrentTripDayIndex(null);
        setCurrentActivityIdx(null);
        setScheduleStatus(null);
        const now = Date.now();
        if (now - lastDateNotice > 60_000) {
          showAlert(
            "Outside Trip Dates",
            `Today (${today}) is outside your planned trip (${tripPlan.startDate} to ${tripPlan.endDate}). Tracking highlights are disabled.`
          );
          setLastDateNotice(now);
        }
        return;
      }
      setCurrentTripDayIndex(dayIdx);
      // Note: Removed auto-switching to allow user to view any day while tracking
      const todaysItinerary = tripPlan.days[dayIdx]?.itinerary || [];
      console.log("[Itinerary] runMonitoring - Using tripPlan day", dayIdx, "itinerary with", todaysItinerary.length, "activities");
      if (!todaysItinerary.length) {
        console.log("[Itinerary] runMonitoring - No activities in today's itinerary, returning");
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
        const now = await getCurrentTime();
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

      // Update current activity and mark as "in-progress" if user arrived
      if (newCurrentIdx !== currentActivityIdx && newCurrentIdx !== null) {
        // User arrived at a new activity, mark it as in-progress
        const updatedStatuses = [...activityStatuses];
        const existingStatus = updatedStatuses.find(s => s.activityIndex === newCurrentIdx);
        
        if (existingStatus && existingStatus.status === 'pending') {
          existingStatus.status = 'in-progress';
          existingStatus.arrivedAt = new Date().toISOString();
          // Extract expected duration from the activity
          const activity = todaysItinerary[newCurrentIdx];
          if (activity.duration) {
            const match = activity.duration.match(/(\d+)/);
            if (match) existingStatus.expectedDuration = parseInt(match[1]);
          }
        } else if (!existingStatus) {
          const activity = todaysItinerary[newCurrentIdx];
          let expectedDuration = 60; // Default 60 minutes
          if (activity.duration) {
            const match = activity.duration.match(/(\d+)/);
            if (match) expectedDuration = parseInt(match[1]);
          }
          updatedStatuses.push({
            activityIndex: newCurrentIdx,
            status: 'in-progress',
            arrivedAt: new Date().toISOString(),
            expectedDuration
          });
        }
        
        saveActivityStatuses(updatedStatuses);
      }
      
      setCurrentActivityIdx(newCurrentIdx);
      
      // Auto-detect activity completion for all activities user has visited
      // Check the current activity and any previous activities that might need completion
      const activitiesToCheck = [];
      if (newCurrentIdx !== null) {
        activitiesToCheck.push(newCurrentIdx);
      }
      // Also check previous activity if user has moved away from it
      if (currentActivityIdx !== null && currentActivityIdx !== newCurrentIdx) {
        activitiesToCheck.push(currentActivityIdx);
      }
      
      for (const activityIdx of activitiesToCheck) {
        if (activityIdx >= todaysItinerary.length) continue;
        
        const activity = todaysItinerary[activityIdx];
        const activityLat = activity.lat ?? activity.coordinates?.lat;
        const activityLng = activity.lng ?? activity.coordinates?.lng;
        
        if (activityLat == null || activityLng == null) continue;
        
        const distanceToActivity = haversineMeters(userLocation, { lat: activityLat, lng: activityLng });
        const isAtActivity = distanceToActivity <= 120; // Arrival threshold: 120m
        const isFarFromActivity = distanceToActivity > 2000; // Leaving threshold: 2km
        
        // Step 1: Detect arrival at activity
        if (isAtActivity && !wasAtActivityRef.current[activityIdx]) {
          wasAtActivityRef.current[activityIdx] = true;
          hasLeftActivityRef.current[activityIdx] = false;
          console.log("[Completion] User arrived at activity:", activity.name, "index:", activityIdx);
        }
        
        // Step 2: Detect leaving activity (moved more than 2km away)
        if (wasAtActivityRef.current[activityIdx] && isFarFromActivity && !hasLeftActivityRef.current[activityIdx]) {
          hasLeftActivityRef.current[activityIdx] = true;
          console.log("[Completion] User left activity (moved >2km away):", activity.name, "index:", activityIdx, "distance:", distanceToActivity, "m");
        }
        
        // Step 3: Check if moving toward next activity (only if we've left current)
        if (hasLeftActivityRef.current[activityIdx] && activityIdx < todaysItinerary.length - 1) {
          const nextActivity = todaysItinerary[activityIdx + 1];
          const nextLat = nextActivity.lat ?? nextActivity.coordinates?.lat;
          const nextLng = nextActivity.lng ?? nextActivity.coordinates?.lng;
          
          if (nextLat != null && nextLng != null) {
            const distanceToNext = haversineMeters(userLocation, { lat: nextLat, lng: nextLng });
            const distanceFromCurrent = haversineMeters(userLocation, { lat: activityLat, lng: activityLng });
            
            // User is moving closer to next activity (closer to next than to current)
            // Also check they're within reasonable distance of next (not too far)
            const isMovingTowardNext = distanceToNext < distanceFromCurrent && distanceToNext < 1000;
            
            if (isMovingTowardNext) {
              // Check cooldown (10 minutes = 600000 ms)
              const lastPromptTime = completionPromptCooldownRef.current[activityIdx] || 0;
              const timeSinceLastPrompt = Date.now() - lastPromptTime;
              const cooldownPeriod = 10 * 60 * 1000; // 10 minutes
              
              // Check if activity is not already completed
              const activityStatus = activityStatuses.find(s => s.activityIndex === activityIdx);
              const isNotCompleted = !activityStatus || activityStatus.status !== 'completed';
              
              if (timeSinceLastPrompt > cooldownPeriod && isNotCompleted) {
                // All conditions met: arrived, left, moving toward next
                completionPromptCooldownRef.current[activityIdx] = Date.now();
                
                showAlert(
                  "Activity Completion Detected",
                  `We detected that you finished "${activity.name}". Would you like to mark it as complete?`,
                  [
                    {
                      text: "Yes, Mark Complete",
                      onPress: () => {
                        markActivityComplete(activityIdx, false);
                        // Clear tracking for this activity
                        wasAtActivityRef.current[activityIdx] = false;
                        hasLeftActivityRef.current[activityIdx] = false;
                      }
                    },
                    {
                      text: "Not Yet",
                      style: "cancel",
                      onPress: () => {
                        // Will ask again in 10 minutes (cooldown already set)
                        console.log("[Completion] User declined, will ask again in 10 minutes for activity:", activity.name);
                      }
                    }
                  ]
                );
              }
            }
          }
        }
      }
      if (newCurrentIdx !== null) {
        const currentTime = await getCurrentTime();
        const status = calculateScheduleStatus(todaysItinerary, newCurrentIdx, currentTime);
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
    console.log("[Itinerary] runMonitoring - Selecting itinerary source:");
    console.log("[Itinerary] weatherAdaptedResult exists:", !!weatherAdaptedResult?.itinerary);
    console.log("[Itinerary] optimizedResult exists:", !!optimizedResult?.itinerary);
    console.log("[Itinerary] tripPlan day", fallbackDayIndex, "exists:", !!tripPlan?.days?.[fallbackDayIndex]?.itinerary);
    
    const itinerary = weatherAdaptedResult?.itinerary || optimizedResult?.itinerary || tripPlan?.days?.[fallbackDayIndex]?.itinerary;
    if (!itinerary) {
      console.log("[Itinerary] runMonitoring - No itinerary found, returning");
      return;
    }
    
    console.log("[Itinerary] runMonitoring - Using itinerary with", itinerary.length, "activities");
    if (weatherAdaptedResult?.itinerary) {
      console.log("[Itinerary] runMonitoring - Source: weatherAdaptedResult");
    } else if (optimizedResult?.itinerary) {
      console.log("[Itinerary] runMonitoring - Source: optimizedResult");
    } else {
      console.log("[Itinerary] runMonitoring - Source: tripPlan day", fallbackDayIndex);
    }

    const idx = itinerary.findIndex((item: any) => {
      const lat = item.lat ?? item.coordinates?.lat;
      const lng = item.lng ?? item.coordinates?.lng;
      if (lat == null || lng == null) return false;
      const d = haversineMeters(userLocation, { lat, lng });
      return d <= 120; // within 120m
    });

    let newCurrentIdx: number | null = idx !== -1 ? idx : null;
    if (newCurrentIdx === null) {
      const now = await getCurrentTime();
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
      const currentTime = await getCurrentTime();
      const status = calculateScheduleStatus(itinerary, newCurrentIdx, currentTime);
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
    };
    
    runMonitoring();
  }, [isTracking, userLocation, optimizedResult, weatherAdaptedResult, tripPlan, currentTripDayIndex, lastScheduleCheck, lastDateNotice, selectedDayIndex, currentActivityIdx, activityStatuses, checkAndHandleLocationMismatch]);

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
 
        // Clear any canceled flags from the new trip plan (shouldn't have any, but just in case)
        const cleanedTrip = {
          ...trip,
          days: trip.days?.map((day: any) => ({
            ...day,
            itinerary: day.itinerary?.map((activity: any) => {
              const { canceled, canceledReason, ...rest } = activity;
              return rest;
            }) || []
          })) || []
        };
        
        setTripPlan(cleanedTrip);
        const initialItinerary = cleanedTrip.days?.[0]?.itinerary ?? [];
        console.log("[Itinerary] runMultiDayGeneration - Setting optimizedResult");
        console.log("[Itinerary] Initial itinerary length:", initialItinerary.length);
        if (initialItinerary.length) {
          console.log("[Itinerary] Setting optimizedResult with", initialItinerary.length, "activities");
          setOptimizedResult({ itinerary: initialItinerary });
          setCurrentTripDayIndex(0);
        } else {
          console.log("[Itinerary] Clearing optimizedResult (no activities)");
          setOptimizedResult(null);
        }
        
        // Clear activity statuses for all days in the trip for a fresh start
        if (cleanedTrip?.days?.length && cleanedTrip.startDate) {
          for (let i = 0; i < cleanedTrip.days.length; i++) {
            const statusKey = `activityStatus_${cleanedTrip.startDate}_day${i}`;
            await AsyncStorage.removeItem(statusKey);
            // Clear fatigue detection disabled flags for all days
            await AsyncStorage.removeItem(`fatigueDetectionDisabled_day_${i}`);
          }
        }
        setActivityStatuses([]);
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
        
      await AsyncStorage.setItem("savedTripPlan", JSON.stringify(cleanedTrip));

        // Notification removed - trip plan is displayed directly
    } catch (e: any) {
        console.error("Trip generation failed:", e?.message || e);
        if (!silent) {
          showAlert("Error", e?.message || "Failed to generate trip");
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
        showAlert("Location needed", "Cannot suggest replacements without a reference location.");
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
      showAlert("Error", "Failed to replace item.");
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
      showAlert("Error", validation.error || "Invalid replacement place");
      return;
    }

    if (!userLocation) {
      showAlert("Location Required", "Location is needed to regenerate the itinerary");
      return;
    }

    try {
      // Show loading indicator
      showAlert("Regenerating", "Re-generating itinerary with new activity and adjusted times...");

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
        console.log("[Itinerary] handleReplaceMultiDayItem - Updating optimizedResult for day", dayIndex);
        console.log("[Itinerary] Reoptimized itinerary length:", reoptimized.length);
        setOptimizedResult({ itinerary: reoptimized });
      } else {
        console.log("[Itinerary] handleReplaceMultiDayItem - Not updating optimizedResult (viewing day", selectedDayIndex, "but replaced day", dayIndex, ")");
      }

    setReplaceContext(null);
    setReplacementSuggestions(null);

      showAlert(
        "Replaced & Regenerated",
        `"${item.name}" has been replaced with "${p.name}" and the itinerary has been regenerated with adjusted times.`
      );
    } catch (error: any) {
      console.error("Failed to apply replacement and regenerate:", error);
      showAlert("Error", error?.message || "Failed to replace activity and regenerate itinerary");
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
        showAlert("Error", "No saved itinerary found.");
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
      console.log("[Itinerary] handleOptimizeItinerary - Setting optimizedResult from saved itinerary");
      console.log("[Itinerary] Optimized itinerary length:", optimized.length);
      console.log("[Itinerary] Optimized activities:", optimized.map((item: any) => `${item.name} (${item.start_time || 'no time'})`));
      setOptimizedResult(obj);

      await AsyncStorage.setItem("optimizedItinerary", JSON.stringify(obj));

      showAlert("Success", "Optimized itinerary saved!");
      console.log("Optimized itinerary saved");
    } catch (err: any) {
      console.error("Optimization failed:", err?.message);
      showAlert("Error", err?.message || "Optimization failed");
    }
  };

  // ---------------- Tracking (start/stop) ----------------
  const startTracking = useCallback(async () => {
    if (isTracking) return;
    
    // Check if there's a plan (relaxed check for testing)
    if (tripPlan) {
      const planCheck = checkPlanForToday(tripPlan);
      if (!planCheck.hasPlan) {
        // Allow testing even if not today - just warn user
        showAlert(
          "Testing Mode",
          "Your trip isn't scheduled for today, but you can still test tracking features.",
          [
            { text: "Cancel", style: "cancel", onPress: () => {} },
            { text: "Start Anyway", onPress: async () => {
              // Continue with tracking
              const { status } = await Location.requestForegroundPermissionsAsync();
              if (status !== "granted") {
                showAlert("Permission required", "Please enable location permission.");
                return;
              }
              await proceedWithTracking();
            }}
          ]
        );
        return;
      }
    } else if (!optimizedResult?.itinerary && !weatherAdaptedResult?.itinerary) {
      showAlert(
        "No Itinerary",
        "No itinerary available to track. Please generate a plan first."
      );
      return;
    }
    
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      showAlert("Permission required", "Please enable location permission.");
      return;
    }

    await proceedWithTracking();
  }, [isTracking, tripPlan, optimizedResult, weatherAdaptedResult]);

  const proceedWithTracking = useCallback(async () => {

    dgroup("start");
    dlog("when", new Date().toISOString());
    dlog("intervalMs", TICK_INTERVAL_MS);
    dend();

    setIsTracking(true);
    setTotalMetersToday(0);
    setFatigueScore(0);
    lastPointRef.current = null;
    
    // Save tracking state for fatigue tab
    await AsyncStorage.setItem("isTracking", "true");

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

  const stopTracking = useCallback(async () => {
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
    
    // Save tracking state for fatigue tab
    await AsyncStorage.setItem("isTracking", "false");
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

            showAlert(
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
      showAlert("Location Required", "Location is needed to re-optimize the itinerary");
      return;
    }

    try {
      // Show loading indicator
      showAlert("Reoptimizing", "Re-generating itinerary with new activity and adjusted times...");

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
        showAlert("Error", "Invalid activity index");
        return;
      }

      // Ensure the alternative has required location fields
      const altLat = alternative.lat || alternative.coordinates?.lat;
      const altLng = alternative.lng || alternative.coordinates?.lng;
      
      if (!altLat || !altLng) {
        showAlert("Error", "Alternative location information is missing");
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
        showAlert("Error", "Failed to re-optimize itinerary");
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

      showAlert(
        "Replaced & Re-optimized",
        `"${originalActivity.name}" has been replaced with "${alternative.name}" and the itinerary times have been adjusted.`
      );
    } catch (error) {
      console.error("Failed to apply weather replacement:", error);
      showAlert("Error", "Failed to replace and re-optimize activity");
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
    
    showAlert(
      "Schedule Adjustment Needed",
      `You're ${scheduleStatus?.delayMinutes || 0} minutes behind schedule.\n\n${adjustment.description}\n\nImpact: ${adjustment.impact}`,
      [
        {
          text: "Apply This Change",
          onPress: () => applyScheduleAdjustment(adjustment),
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

    showAlert(
      "Choose Schedule Adjustment",
      "Select how you'd like to adjust your schedule:",
      options
    );
  }, []);

  const applyScheduleAdjustment = useCallback(async (adjustment: any) => {
    try {
      console.log("Applying schedule adjustment:", adjustment.type);
      
      // Update the trip plan if we're tracking a multi-day trip
      if (tripPlan && currentTripDayIndex !== null && currentTripDayIndex !== undefined) {
        const updatedPlan = JSON.parse(JSON.stringify(tripPlan)); // Deep copy
        const dayItinerary = updatedPlan.days[currentTripDayIndex]?.itinerary || [];
        
        // Update the itinerary for the current day
        updatedPlan.days[currentTripDayIndex].itinerary = adjustment.newItinerary;
        
        // Save updated trip plan
        setTripPlan(updatedPlan);
        await AsyncStorage.setItem("savedTripPlan", JSON.stringify(updatedPlan));
        
        // Update optimized result if viewing this day
        if (selectedDayIndex === currentTripDayIndex) {
          setOptimizedResult({ itinerary: adjustment.newItinerary });
        }
        
        // If weather adapted result exists, update it too
        if (weatherAdaptedResult && selectedDayIndex === currentTripDayIndex) {
          setWeatherAdaptedResult({ itinerary: adjustment.newItinerary });
        }
      } else {
        // Single-day trip or no trip plan - just update optimized result
        setOptimizedResult({ itinerary: adjustment.newItinerary });
        
        // If weather adapted result exists, update it
        if (weatherAdaptedResult) {
          setWeatherAdaptedResult({ itinerary: adjustment.newItinerary });
        }
      }
      
      // Save the adjustment for reference
      await saveScheduleAdjustment(adjustment);
      
      // Clear the adjustments list
      setScheduleAdjustments([]);
      
      // Force a refresh of schedule status
      if (currentActivityIdx !== null && adjustment.newItinerary.length > 0) {
        const currentTime = await getCurrentTime();
        const newStatus = calculateScheduleStatus(adjustment.newItinerary, currentActivityIdx, currentTime);
        setScheduleStatus(newStatus);
      }
      
      showAlert(
        "Schedule Updated",
        `Applied: ${adjustment.description}\n\n${adjustment.impact}\n\nThe schedule has been updated with new times.`
      );
      
      // Force a re-render to show updated times
      setTimeout(() => {
        if (tripPlan) {
          setTripPlan({ ...tripPlan });
        }
      }, 100);
      
    } catch (error) {
      console.error("Failed to apply schedule adjustment:", error);
      showAlert("Error", "Failed to apply schedule adjustment");
    }
  }, [tripPlan, currentTripDayIndex, selectedDayIndex, weatherAdaptedResult, currentActivityIdx]);

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
  // Track userLocation changes to debug distance updates
  React.useEffect(() => {
    console.log(`[Location] ===== userLocation STATE CHANGED =====`);
    console.log(`[Location] New userLocation:`, userLocation);
    console.log(`[Location] ===== userLocation STATE CHANGE COMPLETE =====`);
  }, [userLocation]);

  const renderItinerary = (result: any, title: string) => {
    console.log(`[Itinerary] renderItinerary called for "${title}"`);
    console.log(`[Itinerary] renderItinerary - userLocation:`, userLocation);
    console.log(`[Itinerary] renderItinerary - isTracking:`, isTracking);
    console.log(`[Itinerary] Result exists:`, !!result);
    console.log(`[Itinerary] Result has itinerary:`, !!result?.itinerary);
    
    if (!result?.itinerary) {
      console.log(`[Itinerary] renderItinerary returning null (no itinerary)`);
      return null;
    }

    const itinerary = result.itinerary;
    console.log(`[Itinerary] Rendering itinerary with ${itinerary.length} activities for "${title}"`);

    // Calculate progress based on completed activities from activityStatuses
    const totalActivities = itinerary.length;
    const completedActivities = activityStatuses.filter(
      status => status.status === 'completed' && status.activityIndex >= 0 && status.activityIndex < totalActivities
    ).length;
    
    // Also count activities that are "past" the current activity index as completed
    // (for backwards compatibility with currentActivityIdx-based tracking)
    const pastCurrentActivities = currentActivityIdx !== null && currentActivityIdx > 0 
      ? currentActivityIdx 
      : 0;
    
    // Use the higher count to ensure progress reflects both manual completions and automatic progress
    const completedCount = Math.max(completedActivities, pastCurrentActivities);
    const progressPercentage = totalActivities > 0 ? (completedCount / totalActivities) * 100 : 0;
    
    console.log(`[Progress] Total: ${totalActivities}, Completed (from statuses): ${completedActivities}, Past current: ${pastCurrentActivities}, Final count: ${completedCount}, Percentage: ${progressPercentage.toFixed(1)}%`);

    return (
      <>
        <Text className="text-lg font-rubik-bold text-black-300 mb-3">{title}</Text>
        
        {/* Location Status */}
        {isTracking && currentActivityIdx === null && Array.isArray(currentItinerary) && currentItinerary.length > 0 && (
          <View className="mb-3 bg-general-100 rounded-2xl p-4">
            <View className="flex-row items-center mb-1">
              <View className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: '#F59E0B' }} />
              <Text className="text-sm font-rubik-bold text-black-300">Not at scheduled location</Text>
            </View>
            <Text className="text-xs text-black-200 font-rubik">
              Move closer to an activity to track progress
            </Text>
          </View>
        )}

        {/* Progress Bar */}
        {isTracking && totalActivities > 0 && (
          <View className="mb-3 bg-general-100 rounded-2xl p-4">
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-sm font-rubik-bold text-black-300">Progress</Text>
              <Text className="text-sm text-black-300 font-rubik-medium">
                {completedCount}/{totalActivities}
              </Text>
            </View>
            <View className="w-full bg-gray-200 rounded-full h-2">
              <View 
                className="bg-primary-300 h-2 rounded-full"
                style={{ width: `${progressPercentage}%` }}
              />
            </View>
            <Text className="text-xs text-black-200 font-rubik mt-1">
              {progressPercentage.toFixed(0)}% complete
            </Text>
          </View>
        )}
        {itinerary.map((item: any, idx: number) => {
          const isCurrent = isTracking && currentActivityIdx === idx;
          const isCompleted = isTracking && currentActivityIdx !== null && idx < currentActivityIdx;
          const isUpcoming = isTracking && currentActivityIdx !== null && idx > currentActivityIdx;
          const isOverdue = isTracking && scheduleStatus?.isBehindSchedule && isCurrent;
          
          // Check if activity is canceled
          // IMPORTANT: Only check item.canceled flag, NOT activityStatuses
          // activityStatuses are loaded for currentTripDayIndex (Day 1), but optimized itinerary
          // might show a different day's activities, causing incorrect canceled status
          // The item.canceled flag is the source of truth stored in the itinerary data itself
          const isCanceled = item.canceled === true;
          
          // Calculate distance from user location to activity
          // Always calculate if tracking and userLocation exists (for optimized itinerary view)
          let distanceMeters: number | null = null;
          let distanceDisplay: string = "";
          console.log(`[Distance] Activity "${item.name}": isTracking=${isTracking}, userLocation=`, userLocation, `isCanceled=${isCanceled}`);
          if (isTracking && userLocation && !isCanceled) {
            const activityLat = item.lat ?? item.coordinates?.lat;
            const activityLng = item.lng ?? item.coordinates?.lng;
            console.log(`[Distance] Activity "${item.name}": activityLat=${activityLat}, activityLng=${activityLng}`);
            if (activityLat != null && activityLng != null) {
              // Recalculate distance on every render to ensure it updates when location changes
              distanceMeters = haversineMeters(userLocation, { lat: activityLat, lng: activityLng });
              console.log(`[Distance] Activity "${item.name}": Calculated distance=${distanceMeters}m from userLocation`, userLocation, `to activity`, { lat: activityLat, lng: activityLng });
              if (distanceMeters < 1000) {
                distanceDisplay = `${Math.round(distanceMeters)}m away`;
              } else {
                distanceDisplay = `${(distanceMeters / 1000).toFixed(1)}km away`;
              }
              console.log(`[Distance] Activity "${item.name}": distanceDisplay="${distanceDisplay}"`);
            } else {
              console.log(`[Distance] Activity "${item.name}": Missing lat/lng, skipping distance calculation`);
            }
          } else {
            console.log(`[Distance] Activity "${item.name}": Skipping distance (isTracking=${isTracking}, userLocation exists=${!!userLocation}, isCanceled=${isCanceled})`);
          }
          
          // Determine status color
          let statusColor = "#6B7280"; // Default gray
          if (isCanceled) {
            statusColor = "#DC2626"; // Red for canceled
          } else if (isCompleted) {
            statusColor = "#9CA3AF"; // Light gray for completed
          } else if (isCurrent) {
            statusColor = isOverdue ? "#EF4444" : "#10B981"; // Red if overdue, green if on time
          } else if (isUpcoming) {
            statusColor = "#3B82F6"; // Blue for upcoming
          }
          
          return (
            <View key={`${item.name}-${idx}`} className="mb-3 bg-general-100 rounded-2xl p-4">
              <View className="flex-row items-center mb-2">
                <View className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: statusColor }} />
                <Text className="text-base font-rubik-bold text-black-300 flex-1">
                  {item.name}
                </Text>
              </View>
              
              <View className="flex-row items-center mb-2">
                <Text className="text-sm text-black-300 font-rubik-medium">
                  {item.start_time} - {item.end_time}
                </Text>
                {item.category && (
                  <Text className="text-xs text-black-200 font-rubik ml-2 capitalize">
                    • {item.category}
                  </Text>
                )}
              </View>
              
              {/* Distance Display */}
              {distanceDisplay && (
                <View className="mb-2">
                  <View className="flex-row items-center">
                    <Text className="text-xs text-black-200 font-rubik">
                      📍 {distanceDisplay}
                    </Text>
                    {distanceMeters !== null && distanceMeters > 500 && (
                      <Text className="text-xs text-orange-600 font-rubik ml-2">
                        (Far from planned location)
                      </Text>
                    )}
                  </View>
                </View>
              )}

              {/* Current Activity Status */}
              {isTracking && isCurrent && (
                <View className="mb-2">
                  <Text className="text-sm font-rubik-bold" style={{ color: isOverdue ? '#EF4444' : '#10B981' }}>
                    {isOverdue ? `${scheduleStatus?.delayMinutes || 0}m behind` : "Current"}
                  </Text>
                  {isOverdue && (
                    <Text className="text-xs text-black-200 font-rubik mt-0.5">
                      Consider adjusting schedule
                    </Text>
                  )}
                </View>
              )}

              {/* Canceled Activity Status */}
              {isCanceled && (
                <View className="mb-2">
                  <Text className="text-sm font-rubik-medium text-red-600">
                    ✗ Canceled
                  </Text>
                  <Text className="text-xs text-black-200 font-rubik mt-0.5">
                    This activity was canceled and moved to a later day
                  </Text>
                </View>
              )}

              {/* Completed Activity Status */}
              {isTracking && isCompleted && !isCanceled && (
                <View className="mb-2">
                  <Text className="text-sm font-rubik-medium text-black-200">
                    ✓ Completed
                  </Text>
                </View>
              )}

              {/* Upcoming Activity Status */}
              {isTracking && isUpcoming && !isCanceled && (
                <View className="mb-2">
                  <Text className="text-sm font-rubik-medium text-black-200">
                    Upcoming
                  </Text>
                  {scheduleStatus?.nextActivityStart && idx === currentActivityIdx + 1 && (
                    <Text className="text-xs text-black-200 font-rubik mt-0.5">
                      Starts at {scheduleStatus.nextActivityStart}
                    </Text>
                  )}
                </View>
              )}

              {item.estimated_duration != null && (
                <Text className="text-xs text-black-200 font-rubik">
                  Duration: {typeof item.estimated_duration === "number"
                    ? formatDuration(item.estimated_duration)
                    : item.estimated_duration}
                </Text>
              )}

              {item.travel_time_minutes != null && (
                <Text className="text-xs text-black-200 font-rubik">
                  Travel: {item.travel_time_minutes} min
                </Text>
              )}

              {item.travel_instructions && (
                <Text className="text-xs text-black-200 font-rubik mt-1">
                  {item.travel_instructions}
                </Text>
              )}

              {item.reason && (
                <Text className="text-xs text-black-200 font-rubik italic mt-1">{item.reason}</Text>
              )}

              {item.weatherWarning && (
                <View className="flex-row items-start mt-1">
                  <Text className="text-xs text-black-200 font-rubik">⚠️ {item.weatherWarning}</Text>
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
  // Load fatigue data from AsyncStorage (updated by fatigue.tsx or test override)
  useEffect(() => {
    if (!isTracking) return;
    
    const loadFatigue = async () => {
      try {
        // Check for test override first
        const testOverride = await AsyncStorage.getItem("testFatigueOverride");
        if (testOverride) {
          setCurrentFatigueData(JSON.parse(testOverride));
          return;
        }
        
        // Otherwise use real data
        const data = await AsyncStorage.getItem("currentFatigue");
        if (data) {
          setCurrentFatigueData(JSON.parse(data));
        }
      } catch (err) {
        console.error("[Explore] Error loading fatigue:", err);
      }
    };
    
    loadFatigue();
    const interval = setInterval(loadFatigue, 2000); // Check frequently for testing
    return () => clearInterval(interval);
  }, [isTracking]);

  // Load activity statuses when day changes
  useEffect(() => {
    if (currentTripDayIndex !== null) {
      loadActivityStatuses();
    }
  }, [currentTripDayIndex, tripPlan]);

  // Ref to track "do not show again" checkbox state for fatigue alerts
  const fatigueDoNotShowAgainRef = useRef<boolean>(false);
  
  // Ref to track "do not show again" checkbox state for weather alerts
  const weatherDoNotShowAgainRef = useRef<boolean>(false);
  // Ref to track if weather alert is currently being displayed
  const weatherAlertShowingRef = useRef<boolean>(false);

  // Fatigue detection and auto-adjustment
  useEffect(() => {
    if (!isTracking || !currentFatigueData || !tripPlan || currentTripDayIndex === null) return;
    
    const checkFatigueAndPrompt = async () => {
      const now = Date.now();
      
      // Only check every 2 minutes to avoid spamming
      const timeSinceLastCheck = now - lastFatigueCheck;
      if (timeSinceLastCheck < 120000) {
        const remainingSeconds = Math.ceil((120000 - timeSinceLastCheck) / 1000);
        console.log(`[Fatigue] Check interval not met. Next check in ${remainingSeconds} seconds.`);
        return;
      }
      
      const level = currentFatigueData.level;
      const percentage = currentFatigueData.percentage;
      
      // Only prompt for High or Exhausted fatigue (>60%)
      if (percentage < 60) {
        console.log(`[Fatigue] Fatigue level ${percentage}% is below threshold (60%). No alert.`);
        return;
      }
      
      console.log(`[Fatigue] Checking fatigue: ${level} (${percentage}%)`);
      
      setLastFatigueCheck(now);
      
      // Check if fatigue detection is disabled for this day (user already canceled plans)
      if (currentTripDayIndex !== null) {
        const fatigueDisabled = await AsyncStorage.getItem(`fatigueDetectionDisabled_day_${currentTripDayIndex}`);
        if (fatigueDisabled === "true") {
          console.log(`[Fatigue] Detection disabled for Day ${currentTripDayIndex + 1} (user already canceled plans for this day)`);
          return;
        }
      }
      
      // Check if current activity is a rest stop - skip fatigue detection during rest
      if (currentActivityIdx !== null) {
        const todayItinerary = tripPlan.days[currentTripDayIndex]?.itinerary || [];
        const currentActivity = todayItinerary[currentActivityIdx];
        if (currentActivity?.isRestStop === true) {
          console.log(`[Fatigue] Detection skipped - user is currently resting at: ${currentActivity.name}`);
          return;
        }
      }
      
      // Check if user selected "do not show again for today"
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const doNotShowAgain = await AsyncStorage.getItem(`fatigueDoNotShowAgain_${todayStr}`);
      if (doNotShowAgain === "true") {
        console.log(`[Fatigue] Detection skipped - user selected "do not show again for today" (${todayStr})`);
        return;
      }
      
      // Check if user already dismissed this alert recently
      const lastDismissed = await AsyncStorage.getItem("lastFatigueAlertDismissed");
      if (lastDismissed) {
        const timeSinceDismissed = now - parseInt(lastDismissed);
        const cooldownMs = 1800000; // 30 minutes (changed from 5 minutes)
        if (timeSinceDismissed < cooldownMs) {
          const remainingMinutes = Math.ceil((cooldownMs - timeSinceDismissed) / 60000);
          console.log(`[Fatigue] Alert cooldown active. Remaining: ${remainingMinutes} minute(s). Last dismissed: ${new Date(parseInt(lastDismissed)).toLocaleTimeString()}`);
          return;
        } else {
          console.log(`[Fatigue] Cooldown expired. Last dismissed: ${new Date(parseInt(lastDismissed)).toLocaleTimeString()}`);
        }
      }
      
      console.log(`[Fatigue] Detected ${level} fatigue (${percentage}%), prompting user...`);
      
      // Reset checkbox state for this alert
      fatigueDoNotShowAgainRef.current = false;
      
      const handleButtonPress = async () => {
        if (fatigueDoNotShowAgainRef.current) {
          // Set flag for today
          await AsyncStorage.setItem(`fatigueDoNotShowAgain_${todayStr}`, "true");
          console.log(`[Fatigue] "Do not show again for today" selected for ${todayStr}`);
        }
      };
      
      showAlert(
        "Fatigue Detected",
        `Your fatigue level is ${level} (${percentage}%). Would you like to adjust your plans for today?`,
        [
          {
            text: "Ignore",
            style: "cancel",
            onPress: async () => {
              await handleButtonPress();
              await AsyncStorage.setItem("lastFatigueAlertDismissed", now.toString());
            }
          },
          {
            text: "Find Rest Stop",
            onPress: async () => {
              await handleButtonPress();
              console.log("[Rest Stop] ===== 'Find Rest Stop' button pressed =====");
              findNearestRestStop();
            }
          },
          {
            text: "Cancel Rest of Day",
            onPress: async () => {
              await handleButtonPress();
              cancelRemainingActivities();
            },
            style: "destructive"
          }
        ],
        {
          showDoNotShowAgain: true,
          onDoNotShowAgainChange: (checked: boolean) => {
            fatigueDoNotShowAgainRef.current = checked;
            console.log(`[Fatigue] "Do not show again" checkbox: ${checked}`);
          }
        }
      );
    };
    
    checkFatigueAndPrompt();
  }, [isTracking, currentFatigueData, tripPlan, currentTripDayIndex, lastFatigueCheck]);

  // Weather detection and adjustment
  useEffect(() => {
    console.log("[Weather] ===== WEATHER DETECTION useEffect TRIGGERED =====");
    console.log("[Weather] useEffect - isTracking:", isTracking);
    console.log("[Weather] useEffect - currentWeather:", currentWeather);
    console.log("[Weather] useEffect - userLocation:", userLocation);
    console.log("[Weather] useEffect - tripPlan:", tripPlan ? "EXISTS" : "NULL");
    console.log("[Weather] useEffect - currentTripDayIndex:", currentTripDayIndex);
    
    if (!isTracking || !currentWeather || !userLocation || !tripPlan || currentTripDayIndex === null) {
      console.log("[Weather] useEffect - Missing required data, returning");
      return;
    }
    
    const checkWeatherAndPrompt = async () => {
      console.log("[Weather] ===== checkWeatherAndPrompt() called =====");
      const now = Date.now();
      
      // Only check every 5 seconds (reduced from 10 for faster response)
      const timeSinceLastCheck = now - lastWeatherAlertCheck;
      if (timeSinceLastCheck < 5000) { // 5 seconds
        const remainingSeconds = Math.ceil((5000 - timeSinceLastCheck) / 1000);
        console.log(`[Weather] Check interval not met. Next check in ${remainingSeconds} seconds.`);
        return;
      }
      
      // Check if weather is harsh
      const isHarshWeather = BAD_WEATHER.includes(currentWeather.condition);
      
      if (!isHarshWeather) {
        console.log(`[Weather] Weather is fine: ${currentWeather.condition}`);
        return;
      }
      
      console.log(`[Weather] Harsh weather detected: ${currentWeather.condition}`);
      
      setLastWeatherAlertCheck(now);
      
      // Check if user already dismissed this alert recently
      const lastDismissed = await AsyncStorage.getItem("lastWeatherAlertDismissed");
      if (lastDismissed) {
        const timeSinceDismissed = now - parseInt(lastDismissed);
        const cooldownMs = 1800000; // 30 minutes
        if (timeSinceDismissed < cooldownMs) {
          const remainingMinutes = Math.ceil((cooldownMs - timeSinceDismissed) / 60000);
          console.log(`[Weather] Alert cooldown active. Remaining: ${remainingMinutes} minute(s).`);
          return;
        }
      }
      
      // Check if alert is already being displayed
      if (weatherAlertShowingRef.current) {
        console.log(`[Weather] Alert is already being displayed, skipping duplicate alert`);
        return;
      }
      
      // Check if user selected "do not show again for today"
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const doNotShowAgain = await AsyncStorage.getItem(`weatherDoNotShowAgain_${todayStr}`);
      if (doNotShowAgain === "true") {
        console.log(`[Weather] Detection skipped - user selected "do not show again for today" (${todayStr})`);
        return;
      }
      
      // Get weather duration
      console.log(`[Weather] Fetching weather duration for location:`, { lat: userLocation.lat, lng: userLocation.lng });
      const { getHarshWeatherDuration } = await import("@/lib/weatherAware");
      const weatherDuration = await getHarshWeatherDuration(userLocation.lat, userLocation.lng);
      
      console.log(`[Weather] getHarshWeatherDuration result:`, weatherDuration);
      
      if (!weatherDuration) {
        console.log(`[Weather] Could not determine weather duration - showing alert anyway with default duration`);
        // Show alert even if duration can't be determined
        const defaultDuration = { durationMinutes: 60, durationText: "about 1 hour" };
        const isShortTerm = defaultDuration.durationMinutes < 60;
        
        weatherDoNotShowAgainRef.current = false;
        
        const handleButtonPress = async () => {
          if (weatherDoNotShowAgainRef.current) {
            await AsyncStorage.setItem(`weatherDoNotShowAgain_${todayStr}`, "true");
            console.log(`[Weather] "Do not show again for today" selected for ${todayStr}`);
          }
        };
        
        console.log("[Weather] Using default duration, showing fallback alert");
        if (isShortTerm) {
          console.log("[Weather] Fallback - Showing SHORT-TERM weather alert");
          weatherAlertShowingRef.current = true; // Mark alert as showing
          showAlert(
            "Harsh Weather Detected",
            `We detected ${currentWeather.condition.toLowerCase()} conditions. Expected to last ${defaultDuration.durationText}.\n\nWould you like to find a nearby place to wait it out?`,
            [
              {
                text: "Ignore",
                style: "cancel",
                onPress: async () => {
                  weatherAlertShowingRef.current = false; // Clear flag when dismissed
                  await handleButtonPress();
                  await AsyncStorage.setItem("lastWeatherAlertDismissed", now.toString());
                }
              },
              {
                text: "Find Rest Stop",
                onPress: async () => {
                  weatherAlertShowingRef.current = false; // Clear flag when dismissed
                  await handleButtonPress();
                  console.log("[Weather] User wants to find rest stop");
                  findNearestRestStop();
                }
              }
            ],
            {
              showDoNotShowAgain: true,
              onDoNotShowAgainChange: (checked: boolean) => {
                weatherDoNotShowAgainRef.current = checked;
                console.log(`[Weather] "Do not show again" checkbox: ${checked}`);
              }
            }
          );
        } else {
          console.log("[Weather] Fallback - Showing LONG-TERM weather alert");
          weatherAlertShowingRef.current = true; // Mark alert as showing
          showAlert(
            "Harsh Weather Detected",
            `We detected ${currentWeather.condition.toLowerCase()} conditions. Expected to last ${defaultDuration.durationText}.\n\nWould you like to regenerate today's itinerary with indoor activities only?`,
            [
              {
                text: "No, Keep Current Plan",
                style: "cancel",
                onPress: async () => {
                  weatherAlertShowingRef.current = false; // Clear flag when dismissed
                  await handleButtonPress();
                  await AsyncStorage.setItem("lastWeatherAlertDismissed", now.toString());
                }
              },
              {
                text: "Regenerate with Indoor Activities",
                onPress: async () => {
                  weatherAlertShowingRef.current = false; // Clear flag when dismissed
                  await handleButtonPress();
                  const now = Date.now();
                  // Set dismissed flag to prevent alert from showing again
                  await AsyncStorage.setItem("lastWeatherAlertDismissed", now.toString());
                  console.log("[Weather] User wants to regenerate with indoor activities - dismissed alert for 30 minutes");
                  regenerateItineraryWithIndoorActivities();
                }
              }
            ],
            {
              showDoNotShowAgain: true,
              onDoNotShowAgainChange: (checked: boolean) => {
                weatherDoNotShowAgainRef.current = checked;
                console.log(`[Weather] "Do not show again" checkbox: ${checked}`);
              }
            }
          );
        }
        return;
      }
      
      const isShortTerm = weatherDuration.durationMinutes < 60; // Less than 1 hour
      
      console.log(`[Weather] Weather expected to last: ${weatherDuration.durationText} (${weatherDuration.durationMinutes} minutes)`);
      console.log(`[Weather] Is short-term: ${isShortTerm}`);
      
      // Reset checkbox state for this alert
      weatherDoNotShowAgainRef.current = false;
      
      const handleButtonPress = async () => {
        if (weatherDoNotShowAgainRef.current) {
          await AsyncStorage.setItem(`weatherDoNotShowAgain_${todayStr}`, "true");
          console.log(`[Weather] "Do not show again for today" selected for ${todayStr}`);
        }
      };
      
      if (isShortTerm) {
        // Short-term: recommend nearby spa or cafe (similar to fatigue detection)
        console.log("[Weather] Showing SHORT-TERM weather alert");
        weatherAlertShowingRef.current = true; // Mark alert as showing
        showAlert(
          "Harsh Weather Detected",
          `We detected ${currentWeather.condition.toLowerCase()} conditions. Expected to last ${weatherDuration.durationText}.\n\nWould you like to find a nearby place to wait it out?`,
          [
            {
              text: "Ignore",
              style: "cancel",
              onPress: async () => {
                weatherAlertShowingRef.current = false; // Clear flag when dismissed
                await handleButtonPress();
                await AsyncStorage.setItem("lastWeatherAlertDismissed", now.toString());
              }
            },
            {
              text: "Find Rest Stop",
              onPress: async () => {
                weatherAlertShowingRef.current = false; // Clear flag when dismissed
                await handleButtonPress();
                console.log("[Weather] User wants to find rest stop");
                findNearestRestStop();
              }
            }
          ],
          {
            showDoNotShowAgain: true,
            onDoNotShowAgainChange: (checked: boolean) => {
              weatherDoNotShowAgainRef.current = checked;
              console.log(`[Weather] "Do not show again" checkbox: ${checked}`);
            }
          }
        );
      } else {
        // Long-term: ask if user wants to regenerate itinerary with indoor activities
        console.log("[Weather] Showing LONG-TERM weather alert");
        weatherAlertShowingRef.current = true; // Mark alert as showing
        showAlert(
          "Harsh Weather Detected",
          `We detected ${currentWeather.condition.toLowerCase()} conditions. Expected to last ${weatherDuration.durationText}.\n\nWould you like to regenerate today's itinerary with indoor activities only?`,
          [
            {
              text: "No, Keep Current Plan",
              style: "cancel",
              onPress: async () => {
                weatherAlertShowingRef.current = false; // Clear flag when dismissed
                await handleButtonPress();
                await AsyncStorage.setItem("lastWeatherAlertDismissed", now.toString());
              }
            },
              {
                text: "Regenerate with Indoor Activities",
                onPress: async () => {
                  weatherAlertShowingRef.current = false; // Clear flag when dismissed
                  await handleButtonPress();
                  const now = Date.now();
                  // Set dismissed flag to prevent alert from showing again
                  await AsyncStorage.setItem("lastWeatherAlertDismissed", now.toString());
                  console.log("[Weather] User wants to regenerate with indoor activities (fallback) - dismissed alert for 30 minutes");
                  regenerateItineraryWithIndoorActivities();
                }
              }
            ],
          {
            showDoNotShowAgain: true,
            onDoNotShowAgainChange: (checked: boolean) => {
              weatherDoNotShowAgainRef.current = checked;
              console.log(`[Weather] "Do not show again" checkbox: ${checked}`);
            }
          }
        );
      }
    };
    
    // Check immediately
    checkWeatherAndPrompt();
    
    // Also check every 5 seconds while tracking for faster response
    const weatherCheckInterval = setInterval(() => {
      checkWeatherAndPrompt();
    }, 5000); // Check every 5 seconds
    
    return () => {
      clearInterval(weatherCheckInterval);
    };
  }, [isTracking, currentWeather, userLocation, tripPlan, currentTripDayIndex, lastWeatherAlertCheck]);

  // Helper function to regenerate itinerary with indoor activities only
  const regenerateItineraryWithIndoorActivities = async () => {
    if (!tripPlan || currentTripDayIndex === null || !userLocation) {
      showAlert("Error", "Unable to regenerate itinerary. Missing required information.");
      return;
    }
    
    try {
      // Set loading state to show progress
      setLoading(true);
      setLoadingStatus({
        stage: "regenerating",
        message: "Regenerating itinerary with indoor activities...",
        progress: 0
      });
      console.log("[Weather] Starting itinerary regeneration with indoor activities");
      
      // Get today's date
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      
      // Import the multi-day planner to regenerate just this day
      const { planMultiDayTrip } = await import("@/lib/multidayPlanner");
      
      // For now, we'll need to regenerate the entire trip but only use today's day
      // TODO: In the future, we could optimize this to only regenerate one day
      const newTrip = await planMultiDayTrip({
        onStatus: (update) => {
          console.log("[Weather] Regeneration status:", update);
          setLoadingStatus(update);
        }
      });
      
      if (newTrip && newTrip.days && newTrip.days[currentTripDayIndex]) {
        // Update today's itinerary in the trip plan
        const updatedPlan = { ...tripPlan };
        updatedPlan.days[currentTripDayIndex] = newTrip.days[currentTripDayIndex];
        
        setTripPlan(updatedPlan);
        await AsyncStorage.setItem("savedTripPlan", JSON.stringify(updatedPlan));
        
        // Get the updated itinerary for today and set it as optimized result
        const updatedItinerary = updatedPlan.days[currentTripDayIndex]?.itinerary ?? [];
        console.log("[Itinerary] regenerateItineraryWithIndoorActivities - Setting optimizedResult with", updatedItinerary.length, "activities");
        
        if (updatedItinerary.length > 0) {
          setOptimizedResult({ itinerary: updatedItinerary });
        } else {
          setOptimizedResult(null);
        }
        
        // Clear weather adapted result since we've regenerated with indoor activities
        setWeatherAdaptedResult(null);
        
        // Clear loading state
        setLoading(false);
        setLoadingStatus(null);
        
        showAlert(
          "Itinerary Updated",
          "Today's itinerary has been regenerated with indoor activities only to avoid harsh weather conditions.",
          [{ text: "OK" }]
        );
      } else {
        throw new Error("Failed to regenerate itinerary");
      }
    } catch (error: any) {
      console.error("[Weather] Failed to regenerate itinerary:", error);
      setLoading(false);
      setLoadingStatus(null);
      showAlert("Error", `Failed to regenerate itinerary: ${error.message || error.toString()}`);
    }
  };

  // Helper to calculate distance between two coordinates
  const calculateDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in km
  };

  // Helper function to find nearest rest stop (cafe, spa, park, garden)
  const findNearestRestStop = async () => {
    console.log("[Rest Stop] ===== findNearestRestStop() called =====");
    console.log("[Rest Stop] userLocation:", userLocation);
    console.log("[Rest Stop] tripPlan:", tripPlan ? "EXISTS" : "NULL");
    console.log("[Rest Stop] currentTripDayIndex:", currentTripDayIndex);
    
    if (!userLocation || !tripPlan || currentTripDayIndex === null) {
      console.log("[Rest Stop] ERROR - Missing required data");
      showAlert("Error", "Unable to find rest stops. Location not available.");
      return;
    }
    
    try {
      console.log("[Rest Stop] Starting search...");
      console.log("[Rest Stop] Search location:", { lat: userLocation.lat, lng: userLocation.lng });
      
      // Don't show alert here - it blocks the async operation
      // showAlert("Searching", "Finding nearest rest stops...");
      
      const { getPlacesNearby } = await import("@/lib/google");
      console.log("[Rest Stop] getPlacesNearby imported");
      
      // Search for cafes and spas only (focused rest stops)
      console.log("[Rest Stop] Searching for cafes and spas...");
      const [cafes, spas] = await Promise.all([
        getPlacesNearby(userLocation.lat, userLocation.lng, "cafe", 2000),
        getPlacesNearby(userLocation.lat, userLocation.lng, "spa", 2000),
      ]);
      
      console.log("[Rest Stop] Search results - Cafes found:", cafes?.length || 0);
      console.log("[Rest Stop] Search results - Spas found:", spas?.length || 0);
      
      const allRestStops = [
        ...(cafes || []), 
        ...(spas || [])
      ].filter(place => {
        // Filter out generic point_of_interest, only keep actual cafes and spas
        const type = place.primaryType || place.types?.[0] || "";
        const isValid = type.includes("cafe") || type.includes("spa") || type.includes("coffee") || type.includes("restaurant");
        if (!isValid) {
          console.log("[Rest Stop] Filtered out place:", place.name, "type:", type);
        }
        return isValid;
      });
      
      console.log("[Rest Stop] After filtering - Total rest stops:", allRestStops.length);
      
      if (!allRestStops.length) {
        console.log("[Rest Stop] No rest stops found after filtering");
        showAlert("No Rest Stops Found", "No suitable rest stops found nearby.");
        return;
      }
      
      // Calculate distance and add to each place
      console.log("[Rest Stop] Calculating distances...");
      const restStopsWithDistance = allRestStops.map(place => {
        const lat = place.location?.latitude || place.lat;
        const lng = place.location?.longitude || place.lng;
        const distance = calculateDistanceKm(userLocation.lat, userLocation.lng, lat, lng);
        return { ...place, distance };
      });
      
      console.log("[Rest Stop] Distances calculated for", restStopsWithDistance.length, "places");
      
      // Sort by distance, filter by rating, take top 5
      const restStops = restStopsWithDistance
        .filter(place => {
          const rating = place.rating || 0;
          const passes = rating >= 3.5;
          if (!passes) {
            console.log("[Rest Stop] Filtered out low-rated place:", place.name, "rating:", rating);
          }
          return passes;
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5);
      
      console.log("[Rest Stop] After rating filter and sorting - Final rest stops:", restStops.length);
      restStops.forEach((place, idx) => {
        console.log(`[Rest Stop] ${idx + 1}. ${place.name || place.displayName} - ${Math.round(place.distance * 1000)}m (rating: ${place.rating})`);
      });
      
      if (!restStops.length) {
        console.log("[Rest Stop] No highly-rated rest stops found");
        showAlert("No Rest Stops Found", "No highly-rated rest stops nearby. Try adjusting your route.");
        return;
      }
      
      // Show options with distance and type
      const options = restStops.map((place) => ({
        text: `${place.displayName || place.name} - ${Math.round(place.distance * 1000)}m (${place.primaryType || 'rest stop'})`,
        onPress: () => {
          console.log("[Rest Stop] User selected:", place.name);
          insertRestStop(place);
        }
      }));
      
      console.log("[Rest Stop] Showing selection alert with", options.length, "options");
      showAlert(
        "Select Rest Stop",
        "Choose a place to rest (sorted by distance):",
        [
          ...options,
          { text: "Cancel", style: "cancel", onPress: () => console.log("[Rest Stop] User canceled selection") }
        ]
      );
      console.log("[Rest Stop] ===== findNearestRestStop() complete =====");
    } catch (error: any) {
      console.error("[Rest Stop] ERROR in findNearestRestStop:", error);
      console.error("[Rest Stop] Error stack:", error.stack);
      showAlert("Error", `Failed to find rest stops: ${error.message || error.toString()}`);
    }
  };
  
  // Helper function to insert a rest stop into today's itinerary
  const insertRestStop = async (place: any) => {
    console.log("[Rest Stop] ===== insertRestStop() called =====");
    console.log("[Rest Stop] Place:", place.name || place.displayName);
    console.log("[Rest Stop] tripPlan:", tripPlan ? "EXISTS" : "NULL");
    console.log("[Rest Stop] currentTripDayIndex:", currentTripDayIndex);
    
    if (!tripPlan || currentTripDayIndex === null) {
      console.log("[Rest Stop] ERROR - Missing tripPlan or currentTripDayIndex");
      return;
    }
    
    try {
      console.log("[Rest Stop] Creating updated plan...");
      const updatedPlan = { ...tripPlan };
      const todayItinerary = [...(updatedPlan.days[currentTripDayIndex]?.itinerary || [])];
      console.log("[Rest Stop] Today's itinerary has", todayItinerary.length, "activities");
      
      // Find next activity (after current activity)
      const nextActivityIndex = currentActivityIdx !== null ? currentActivityIdx + 1 : 0;
      
      // Determine duration in minutes based on place type
      let durationMinutes = 45; // Default 45 minutes
      let durationText = "30-60 minutes";
      const placeType = place.primaryType || place.types?.[0] || "cafe";
      if (placeType.includes("spa") || placeType.includes("massage")) {
        durationMinutes = 75;
        durationText = "60-90 minutes";
      } else if (placeType.includes("park") || placeType.includes("garden")) {
        durationMinutes = 30;
        durationText = "20-40 minutes";
      }
      
      // Calculate start and end times
      let startTime = "12:00"; // Default start time
      let endTime = "12:45"; // Default end time
      
      // If there's a previous activity, start after it
      if (currentActivityIdx !== null && todayItinerary[currentActivityIdx]) {
        const prevActivity = todayItinerary[currentActivityIdx];
        if (prevActivity.end_time) {
          startTime = prevActivity.end_time;
        }
      } else if (nextActivityIndex > 0 && todayItinerary[nextActivityIndex - 1]) {
        // Use the previous activity's end time
        const prevActivity = todayItinerary[nextActivityIndex - 1];
        if (prevActivity.end_time) {
          startTime = prevActivity.end_time;
        }
      } else if (todayItinerary[nextActivityIndex]) {
        // If inserting at the beginning, start 1 hour before next activity
        const nextActivity = todayItinerary[nextActivityIndex];
        if (nextActivity.start_time) {
          const nextStartMinutes = timeToMinutes(nextActivity.start_time);
          const startMinutes = Math.max(540, nextStartMinutes - 60); // Don't start before 9am
          startTime = minutesToTime(startMinutes);
        }
      }
      
      // Calculate end time
      const startMinutes = timeToMinutes(startTime);
      const endMinutes = startMinutes + durationMinutes;
      endTime = minutesToTime(endMinutes);
      
      // Create rest stop item with all required fields
      const restStop = {
        place_id: place.id || place.place_id,
        name: place.displayName || place.name,
        coordinates: {
          lat: place.location?.latitude || place.lat,
          lng: place.location?.longitude || place.lng
        },
        lat: place.location?.latitude || place.lat,
        lng: place.location?.longitude || place.lng,
        primaryType: placeType,
        formattedAddress: place.formattedAddress || place.vicinity,
        duration: durationText,
        estimated_duration: durationMinutes,
        start_time: startTime,
        end_time: endTime,
        isRestStop: true,
        rating: place.rating,
        distance: place.distance ? `${Math.round(place.distance * 1000)}m` : undefined,
        category: "rest",
        reason: "Rest stop added due to fatigue"
      };
      
      console.log("[Rest Stop] Rest stop object created:", {
        name: restStop.name,
        start_time: restStop.start_time,
        end_time: restStop.end_time,
        duration: restStop.estimated_duration
      });
      
      // Insert rest stop
      console.log("[Rest Stop] Inserting at index:", nextActivityIndex);
      todayItinerary.splice(nextActivityIndex, 0, restStop);
      console.log("[Rest Stop] After insertion, itinerary has", todayItinerary.length, "activities");
      
      // Adjust subsequent activity times
      console.log("[Rest Stop] Adjusting subsequent activity times...");
      let adjustedCount = 0;
      for (let i = nextActivityIndex + 1; i < todayItinerary.length; i++) {
        const activity = todayItinerary[i];
        if (activity.start_time && activity.end_time) {
          const oldStart = timeToMinutes(activity.start_time);
          const oldEnd = timeToMinutes(activity.end_time);
          const activityDuration = oldEnd - oldStart;
          
          // Shift by the rest stop duration
          const newStart = oldStart + durationMinutes;
          const newEnd = newStart + activityDuration;
          
          activity.start_time = minutesToTime(newStart);
          activity.end_time = minutesToTime(newEnd);
          adjustedCount++;
        }
      }
      console.log("[Rest Stop] Adjusted", adjustedCount, "subsequent activities");
      
      updatedPlan.days[currentTripDayIndex].itinerary = todayItinerary;
      console.log("[Rest Stop] Updated plan created");
      
      console.log("[Rest Stop] Setting tripPlan state...");
      setTripPlan(updatedPlan);
      console.log("[Rest Stop] Saving to AsyncStorage...");
      await AsyncStorage.setItem("savedTripPlan", JSON.stringify(updatedPlan));
      console.log("[Rest Stop] Saved to AsyncStorage");
      
      console.log("[Rest Stop] Showing success alert...");
      showAlert(
        "Rest Stop Added",
        `Added "${restStop.name}" to your itinerary (${durationText}, ${startTime}-${endTime}). Take your time to rest!`,
        [{ text: "OK", onPress: () => console.log("[Rest Stop] User acknowledged success alert") }]
      );
      
      // Mark fatigue alert as handled
      await AsyncStorage.setItem("lastFatigueAlertDismissed", Date.now().toString());
      console.log("[Rest Stop] ===== insertRestStop() complete successfully =====");
    } catch (error: any) {
      console.error("[Rest Stop] ERROR in insertRestStop:", error);
      console.error("[Rest Stop] Error stack:", error.stack);
      showAlert("Error", `Failed to add rest stop: ${error.message || error.toString()}`);
    }
  };
  
  // Helper function to move remaining activities to next day
  // Helper to calculate activity duration in minutes
  const getActivityDuration = (activity: any): number => {
    if (!activity.start_time || !activity.end_time) {
      // Try to parse from estimated_duration
      if (activity.estimated_duration) {
        const match = String(activity.estimated_duration).match(/(\d+)/);
        return match ? parseInt(match[1]) : 60; // Default 60 minutes
      }
      return 60; // Default 60 minutes
    }
    const start = timeToMinutes(activity.start_time);
    const end = timeToMinutes(activity.end_time);
    return end - start;
  };

  // Helper to find available time slots in a day
  const findAvailableTimeSlots = (itinerary: any[], dayStartTime: string = "09:00", dayEndTime: string = "22:00"): number => {
    if (!itinerary || itinerary.length === 0) {
      const start = timeToMinutes(dayStartTime);
      const end = timeToMinutes(dayEndTime);
      return end - start; // Full day available
    }

    let totalUsed = 0;
    itinerary.forEach((activity: any) => {
      if (activity.start_time && activity.end_time) {
        totalUsed += getActivityDuration(activity);
      } else {
        totalUsed += 60; // Default 60 minutes for activities without times
      }
    });

    const start = timeToMinutes(dayStartTime);
    const end = timeToMinutes(dayEndTime);
    const totalAvailable = end - start;
    
    return Math.max(0, totalAvailable - totalUsed);
  };

  // Helper to fit activities into a day's schedule
  const fitActivitiesIntoDay = (activities: any[], existingItinerary: any[], dayStartTime: string = "09:00"): {
    fitted: any[];
    remaining: any[];
    canceled: any[];
  } => {
    const fitted: any[] = [];
    const remaining: any[] = [];
    const canceled: any[] = []; // Always empty - we never cancel activities from future days

    console.log(`[FIT] fitActivitiesIntoDay called with ${activities.length} activities to fit into ${existingItinerary.length} existing activities`);

    if (activities.length === 0) {
      return { fitted, remaining, canceled };
    }

    // Calculate total time needed
    let totalTimeNeeded = 0;
    activities.forEach(activity => {
      totalTimeNeeded += getActivityDuration(activity);
    });

    // Find available time (without canceling any existing activities)
    const availableTime = findAvailableTimeSlots(existingItinerary);

    // Determine start time (after last existing activity or day start)
    let currentTime = existingItinerary.length > 0 
      ? timeToMinutes(existingItinerary[existingItinerary.length - 1].end_time || dayStartTime)
      : timeToMinutes(dayStartTime);

    // Check end of day constraint
    const endOfDay = 22 * 60; // 10 PM
    const timeUntilEndOfDay = endOfDay - currentTime;

    // Try to fit as many activities as possible into available time
    // IMPORTANT: We NEVER cancel existing activities from future days
    // We only use available time slots that are free
    let timeUsed = 0;
    for (const activity of activities) {
      const duration = getActivityDuration(activity);
      
      // Check if activity fits:
      // 1. Must fit within available time slots (if any activities exist)
      // 2. Must fit before end of day
      // 3. If no existing activities, we have full day available
      const fitsInAvailableTime = existingItinerary.length === 0 || (timeUsed + duration <= availableTime);
      const fitsBeforeEndOfDay = duration <= timeUntilEndOfDay;
      
      if (fitsInAvailableTime && fitsBeforeEndOfDay) {
        // Activity fits - add it
        const newActivity = {
          ...activity,
          start_time: minutesToTime(currentTime),
          end_time: minutesToTime(currentTime + duration),
          movedFromDay1: activity.canceled === true, // Mark if moved from Day 1
          originalCanceled: activity.canceled === true
        };
        // Remove canceled flag when moving to future day
        if (newActivity.canceled) {
          delete newActivity.canceled;
        }
        fitted.push(newActivity);
        currentTime += duration;
        timeUsed += duration;
      } else {
        // Activity doesn't fit - add to remaining
        remaining.push(activity);
      }
    }

    console.log(`[FIT] fitActivitiesIntoDay result: fitted=${fitted.length}, remaining=${remaining.length}, canceled=${canceled.length}`);
    if (canceled.length > 0) {
      console.error(`[FIT] ❌ ERROR: fitActivitiesIntoDay is returning canceled activities! This should be empty!`);
    }
    
    return { fitted, remaining, canceled };
  };

  const cancelRemainingActivities = async () => {
    if (!tripPlan || currentTripDayIndex === null) {
      return;
    }
    
    const totalDays = tripPlan.days?.length || 0;
    const hasFutureDays = currentTripDayIndex < totalDays - 1;
    
    if (!hasFutureDays) {
      showAlert(
        "Last Day",
        "This is your last day. Remaining activities will be saved for a potential trip extension.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save for Later",
            onPress: async () => {
              try {
                const todayItinerary = [...(tripPlan.days[currentTripDayIndex]?.itinerary || [])];
                const remainingActivities = currentActivityIdx !== null 
                  ? todayItinerary.slice(currentActivityIdx + 1)
                  : todayItinerary;
                
                if (remainingActivities.length === 0) {
                  showAlert("No Activities", "There are no remaining activities to move.");
                  return;
                }
                
                await AsyncStorage.setItem(
                  "postponedActivities",
                  JSON.stringify({
                    tripId: tripPlan.startDate + tripPlan.endDate,
                    activities: remainingActivities,
                    postponedAt: new Date().toISOString(),
                    originalDay: currentTripDayIndex
                  })
                );
                
                // Disable fatigue detection for this day since user already canceled plans
                if (currentTripDayIndex !== null) {
                  await AsyncStorage.setItem(`fatigueDetectionDisabled_day_${currentTripDayIndex}`, "true");
                }
                
                showAlert("Saved", `${remainingActivities.length} activity(ies) saved for later.`);
              } catch (error: any) {
                showAlert("Error", error.message);
              }
            }
          }
        ]
      );
      return;
    }
    
    // Wait a bit for the previous alert to fully dismiss
    setTimeout(() => {
      showAlert(
        "Move Remaining Activities",
        "Due to fatigue, remaining activities will be moved to future days. The system will attempt to fit them into Day 2 and Day 3. If there's not enough space, some events from those days will be canceled. Do you want to proceed?",
        [
        { text: "No", style: "cancel" },
        {
          text: "Move to Future Days",
          onPress: async () => {
            try {
              if (!tripPlan) {
                showAlert("Error", "Trip plan not found. Please try again.");
                return;
              }
              
              if (currentTripDayIndex === null) {
                showAlert("Error", "Current day not found. Please try again.");
                return;
              }
              
              const updatedPlan = JSON.parse(JSON.stringify(tripPlan)); // Deep copy
              const todayItinerary = [...(updatedPlan.days[currentTripDayIndex]?.itinerary || [])];
              
              // Get activities after current activity (remaining activities)
              const remainingActivities = currentActivityIdx !== null 
                ? todayItinerary.slice(currentActivityIdx + 1)
                : todayItinerary;
              
              if (remainingActivities.length === 0) {
                showAlert("No Activities", "There are no remaining activities to move.");
                return;
              }
              
              console.log(`[CANCEL] ========== STARTING CANCELLATION FOR DAY ${currentTripDayIndex + 1} ==========`);
              console.log(`[CANCEL] Current activity index: ${currentActivityIdx}`);
              console.log(`[CANCEL] Total activities in Day ${currentTripDayIndex + 1}: ${todayItinerary.length}`);
              console.log(`[CANCEL] Activities before cancellation:`, todayItinerary.map((a: any, i: number) => ({ index: i, name: a.name })));
              
              // Keep all activities but mark remaining ones as canceled (they'll be moved)
              // This way they show in UI as canceled before being moved
              const newTodayItinerary = todayItinerary.map((activity, idx) => {
                const shouldCancel = currentActivityIdx !== null 
                  ? idx > currentActivityIdx
                  : true; // Cancel all if no current activity
                
                if (shouldCancel) {
                  console.log(`[CANCEL] ✅ Marking Day ${currentTripDayIndex + 1} activity ${idx} as canceled: "${activity.name}"`);
                  return {
                    ...activity,
                    canceled: true, // Mark as canceled in itinerary
                    canceledReason: "Moved to future days due to fatigue"
                  };
                }
                return activity;
              });
              
              const canceledCount = newTodayItinerary.filter((a: any) => a.canceled === true).length;
              console.log(`[CANCEL] Day ${currentTripDayIndex + 1} - Canceled ${canceledCount} activity(ies)`);
              console.log(`[CANCEL] Day ${currentTripDayIndex + 1} final itinerary:`, newTodayItinerary.map((a: any, i: number) => ({ 
                index: i, 
                name: a.name, 
                canceled: a.canceled 
              })));
              
              updatedPlan.days[currentTripDayIndex].itinerary = newTodayItinerary;
              
              // Attempt to fit activities into future days
              // NOTE: We only cancel activities from the CURRENT day, not from future days
              let activitiesToFit = [...remainingActivities];
              const changes: string[] = [];
              
              // Try to fit into Day 2, Day 3, etc.
              // IMPORTANT: Only cancel activities from the CURRENT day (Day 1), not from future days
              // If there's no space in future days, save activities for later instead of canceling existing ones
              console.log(`[CANCEL] Attempting to fit ${activitiesToFit.length} activity(ies) into future days...`);
              
              for (let dayIdx = currentTripDayIndex + 1; dayIdx < totalDays && activitiesToFit.length > 0; dayIdx++) {
                const dayItinerary = [...(updatedPlan.days[dayIdx]?.itinerary || [])];
                const dayDate = updatedPlan.days[dayIdx]?.date || `Day ${dayIdx + 1}`;
                
                console.log(`[CANCEL] ========== PROCESSING DAY ${dayIdx + 1} (${dayDate}) ==========`);
                console.log(`[CANCEL] Day ${dayIdx + 1} BEFORE - Activities:`, dayItinerary.map((a: any, i: number) => ({ 
                  index: i, 
                  name: a.name, 
                  canceled: a.canceled 
                })));
                console.log(`[CANCEL] Day ${dayIdx + 1} BEFORE - Total: ${dayItinerary.length} activity(ies)`);
                console.log(`[CANCEL] Trying to fit ${activitiesToFit.length} activity(ies) into Day ${dayIdx + 1}...`);
                
                // Try to fit activities WITHOUT canceling existing ones
                // Only use available time slots, don't cancel existing activities
                const result = fitActivitiesIntoDay(activitiesToFit, dayItinerary);
                
                console.log(`[CANCEL] fitActivitiesIntoDay result for Day ${dayIdx + 1}:`, {
                  fitted: result.fitted.length,
                  remaining: result.remaining.length,
                  canceled: result.canceled.length
                });
                
                if (result.canceled.length > 0) {
                  console.error(`[CANCEL] ❌ ERROR: fitActivitiesIntoDay returned ${result.canceled.length} canceled activities! This should NEVER happen!`);
                  console.error(`[CANCEL] Canceled activities:`, result.canceled.map((a: any) => ({ name: a.name })));
                }
                
                if (result.fitted.length > 0) {
                  // Only add activities that fit without canceling anything
                  const updatedDayItinerary = [...dayItinerary, ...result.fitted];
                  updatedPlan.days[dayIdx].itinerary = updatedDayItinerary;
                  
                  console.log(`[CANCEL] Day ${dayIdx + 1} AFTER - Activities:`, updatedDayItinerary.map((a: any, i: number) => ({ 
                    index: i, 
                    name: a.name, 
                    canceled: a.canceled 
                  })));
                  console.log(`[CANCEL] Day ${dayIdx + 1} AFTER - Total: ${updatedDayItinerary.length} activity(ies)`);
                  console.log(`[CANCEL] ✅ Day ${dayIdx + 1}: Added ${result.fitted.length} activity(ies), existing activities unchanged`);
                  
                  changes.push(`Day ${dayIdx + 1}: Added ${result.fitted.length} activity(ies)`);
                  activitiesToFit = result.remaining;
                } else {
                  // No space in this day, try next day
                  console.log(`[CANCEL] ⚠️ Day ${dayIdx + 1}: No space available, trying next day`);
                  continue;
                }
              }
              
              // If there are still activities that couldn't fit, save them
              if (activitiesToFit.length > 0) {
                await AsyncStorage.setItem(
                  "postponedActivities",
                  JSON.stringify({
                    tripId: tripPlan.startDate + tripPlan.endDate,
                    activities: activitiesToFit,
                    postponedAt: new Date().toISOString(),
                    originalDay: currentTripDayIndex
                  })
                );
                changes.push(`${activitiesToFit.length} activity(ies) couldn't fit and were saved for later`);
              }
              
              // Mark canceled activities in activity statuses
              const updatedStatuses = [...activityStatuses];
              
              // Mark today's remaining activities as canceled
              // Since we're keeping them in the itinerary (just marked canceled), we use their actual indices
              console.log(`[CANCEL] Marking statuses for Day ${currentTripDayIndex + 1} activities...`);
              newTodayItinerary.forEach((activity: any, idx: number) => {
                if (activity.canceled === true) {
                  console.log(`[CANCEL] Marking Day ${currentTripDayIndex + 1} activity ${idx} status as canceled: "${activity.name}"`);
                  const statusIndex = updatedStatuses.findIndex(s => s.activityIndex === idx);
                  if (statusIndex >= 0) {
                    updatedStatuses[statusIndex].status = 'canceled';
                    updatedStatuses[statusIndex].completedAt = new Date().toISOString();
                  } else {
                    updatedStatuses.push({
                      activityIndex: idx,
                      status: 'canceled',
                      completedAt: new Date().toISOString()
                    });
                  }
                }
              });
              
              // NOTE: We no longer cancel activities from future days
              // Only activities from the current day (Day 1) are marked as canceled
              
              console.log(`[CANCEL] ========== FINAL STATE OF ALL DAYS ==========`);
              for (let dayIdx = 0; dayIdx < totalDays; dayIdx++) {
                const dayItinerary = updatedPlan.days[dayIdx]?.itinerary || [];
                const canceledInDay = dayItinerary.filter((a: any) => a.canceled === true).length;
                console.log(`[CANCEL] Day ${dayIdx + 1}: ${dayItinerary.length} total activities, ${canceledInDay} canceled`);
                if (canceledInDay > 0 && dayIdx !== currentTripDayIndex) {
                  console.error(`[CANCEL] ❌ ERROR: Day ${dayIdx + 1} has ${canceledInDay} canceled activities but should only affect Day ${currentTripDayIndex + 1}!`);
                  console.error(`[CANCEL] Canceled activities in Day ${dayIdx + 1}:`, 
                    dayItinerary.filter((a: any) => a.canceled === true).map((a: any) => ({ name: a.name }))
                  );
                }
              }
              console.log(`[CANCEL] ========== END FINAL STATE ==========`);
              
              await saveActivityStatuses(updatedStatuses);
              
              // Update activity statuses state immediately
              setActivityStatuses(updatedStatuses);
              
              // Save to AsyncStorage first
              await AsyncStorage.setItem("savedTripPlan", JSON.stringify(updatedPlan));
              
              // Reload activity statuses for all affected days
              if (currentTripDayIndex !== null) {
                await loadActivityStatuses();
              }
              
              // Mark fatigue alert as handled
              await AsyncStorage.setItem("lastFatigueAlertDismissed", Date.now().toString());
              
              // Disable fatigue detection for this day since user already canceled plans
              await AsyncStorage.setItem(`fatigueDetectionDisabled_day_${currentTripDayIndex}`, "true");
              
              // Count canceled activities in today
              const canceledTodayCount = newTodayItinerary.filter((a: any) => a.canceled === true).length;
              
              // Clear optimized results FIRST to force use of tripPlan data
              setOptimizedResult(null);
              setWeatherAdaptedResult(null);
              
              // Update activity statuses state immediately
              setActivityStatuses(updatedStatuses);
              
              // Force trip plan update with new object reference to trigger re-render
              // This MUST be a new object reference so React detects the change
              const refreshedPlan = JSON.parse(JSON.stringify(updatedPlan));
              
              console.log(`[CANCEL] ========== VERIFICATION BEFORE SETTING TRIP PLAN ==========`);
              for (let dayIdx = 0; dayIdx < totalDays; dayIdx++) {
                const dayItinerary = refreshedPlan.days[dayIdx]?.itinerary || [];
                const canceledInDay = dayItinerary.filter((a: any) => a.canceled === true).length;
                if (canceledInDay > 0) {
                  console.log(`[CANCEL] Day ${dayIdx + 1} has ${canceledInDay} canceled:`, 
                    dayItinerary.filter((a: any) => a.canceled === true).map((a: any) => a.name)
                  );
                }
              }
              
              setTripPlan(refreshedPlan);
              console.log(`[CANCEL] Trip plan state updated`);
              
              // Show summary of changes
              const summary = [
                `✅ Itinerary Updated!`,
                ``,
                `Day 1 (Today):`,
                `  • Kept: ${newTodayItinerary.length - canceledTodayCount} activity(ies)`,
                `  • Canceled: ${canceledTodayCount} activity(ies) (marked as canceled, moved to future days)`,
                ``,
                ...(changes.length > 0 ? ['Future Days:', ...changes.map(c => `  • ${c}`), ''] : []),
                ``,
                `The schedule has been automatically updated. You can see canceled activities in Day 1 and moved activities in future days.`
              ].join('\n');
              
              showAlert(
                "Itinerary Updated",
                summary,
                [
                  {
                    text: "OK",
                    onPress: () => {
                      // Ensure we're viewing the updated day
                      // The schedule should already be visible, but this ensures the view refreshes
                      if (selectedDayIndex === currentTripDayIndex) {
                        // Force a tiny state change to trigger re-render
                        setSelectedDayIndex(selectedDayIndex);
                      } else if (currentTripDayIndex < totalDays - 1) {
                        // If user wants to see future days, navigate there
                        setSelectedDayIndex(currentTripDayIndex + 1);
                      }
                    }
                  }
                ]
              );
              
            } catch (error: any) {
              console.error("[Cancel] Error:", error);
              showAlert("Error", `Failed to move activities: ${error?.message || 'Unknown error'}`);
            }
          }
        }
      ]
    );
    }, 300); // Wait 300ms for previous alert to dismiss
  };

  const fatigueBadge = useMemo(
    () => {
      if (!currentFatigueData) return null;
      
      const getFatigueColor = (level: string) => {
        if (level === "Rested") return "#10B981";
        if (level === "Light") return "#3B82F6";
        if (level === "Moderate") return "#F59E0B";
        if (level === "High") return "#F97316";
        return "#EF4444";
      };
      
      return (
        <View className="bg-general-100 rounded-2xl p-4 mb-3">
          <View className="flex-row items-center justify-between mb-2">
            <View className="flex-row items-center">
              <View
                className="w-3 h-3 rounded-full mr-2"
                style={{ backgroundColor: getFatigueColor(currentFatigueData.level) }}
              />
              <Text className="text-base font-rubik-bold text-black-300">
                {currentFatigueData.level}
              </Text>
            </View>
            <Text className="text-xl font-rubik-bold text-primary-300">
              {currentFatigueData.percentage}%
            </Text>
          </View>
          <Text className="text-sm text-black-200 font-rubik">
            {currentFatigueData.budgetRemaining} kcal remaining
          </Text>
        </View>
      );
    },
    [currentFatigueData]
  );

  const weatherBadge = useMemo(
    () => {
      if (!currentWeather) return null;
      
      const getWeatherColor = (condition: string) => {
        if (['Rain', 'Thunderstorm', 'Snow'].includes(condition)) return '#EF4444';
        if (['Clouds', 'Overcast'].includes(condition)) return '#F59E0B';
        return '#10B981';
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
        <View className="bg-general-100 rounded-2xl p-4 mb-3">
          <View className="flex-row items-center justify-between mb-2">
            <View className="flex-row items-center">
              <View
                className="w-3 h-3 rounded-full mr-2"
                style={{ backgroundColor: getWeatherColor(currentWeather.condition) }}
              />
              <Text className="text-base font-rubik-bold text-black-300">
                {currentWeather.condition}
              </Text>
            </View>
            <Text className="text-xl font-rubik-bold text-black-300">
              {currentWeather.temperature}°C
            </Text>
          </View>
          <View className="flex-row justify-between items-center">
            <Text className="text-sm text-black-200 font-rubik">
              {currentWeather.humidity}% humidity
            </Text>
            <Text className="text-xs text-black-200 font-rubik">
              {getTimeSinceLastCheck()}
            </Text>
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
        if (status.isBehindSchedule) return '#EF4444';
        if (status.isOnTime) return '#10B981';
        return '#F59E0B';
      };

      // Calculate distance to current activity
      let currentActivityDistance: string | null = null;
      if (isTracking && userLocation && currentActivityIdx !== null) {
        const currentItinerary = optimizedResult?.itinerary || [];
        const currentActivity = currentItinerary[currentActivityIdx];
        if (currentActivity) {
          const activityLat = currentActivity.lat ?? currentActivity.coordinates?.lat;
          const activityLng = currentActivity.lng ?? currentActivity.coordinates?.lng;
          if (activityLat != null && activityLng != null) {
            const distanceMeters = haversineMeters(userLocation, { lat: activityLat, lng: activityLng });
            if (distanceMeters < 1000) {
              currentActivityDistance = `${Math.round(distanceMeters)}m`;
            } else {
              currentActivityDistance = `${(distanceMeters / 1000).toFixed(1)}km`;
            }
          }
        }
      }

      return (
        <View className="bg-general-100 rounded-2xl p-4 mb-3">
          <View className="flex-row items-center justify-between mb-2">
            <View className="flex-row items-center">
              <View
                className="w-3 h-3 rounded-full mr-2"
                style={{ backgroundColor: getScheduleColor(scheduleStatus) }}
              />
              <Text className="text-base font-rubik-bold text-black-300">
                Schedule
              </Text>
            </View>
            <Text className="text-sm font-rubik-medium text-black-300">
              {scheduleStatus.isBehindSchedule 
                ? `${scheduleStatus.delayMinutes}m behind` 
                : 'On time'}
            </Text>
          </View>
          {currentTimeDisplay && (
            <Text className="text-xs text-black-200 font-rubik mb-1">
              {currentTimeDisplay}
            </Text>
          )}
          {currentActivityDistance && (
            <Text className="text-xs text-black-200 font-rubik mb-1">
              📍 {currentActivityDistance} from current activity
            </Text>
          )}
          {scheduleStatus.nextActivityStart && (
            <Text className="text-sm text-black-200 font-rubik">
              Next: {scheduleStatus.nextActivityStart}
            </Text>
          )}
        </View>
      );
    },
    [scheduleStatus, optimizedResult, currentTimeDisplay, isTracking, userLocation, currentActivityIdx]
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
    <View className="flex-1 bg-white">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 250, paddingTop: 50 }}>
        <View className="px-5">
          {/* Header */}
          <View className="mt-5 mb-5">
            <Text className="text-2xl font-rubik-bold text-black-300">
              Explore
            </Text>
          </View>

          {/* Status Badges - Only show when tracking */}
          {isTracking && (
            <View className="mb-4">
              <Text className="text-sm font-rubik-bold text-black-300 mb-3">
                Live Status
              </Text>
              {fatigueBadge}
              {weatherBadge}
              {scheduleBadge}
            </View>
          )}

          {/* Main Action Buttons */}
          <View className="mb-4">
            <TouchableOpacity
              onPress={isTracking ? stopTracking : startTracking}
              className="w-full bg-primary-100 py-4 px-6 rounded-2xl mb-3"
            >
              <Text className="text-white text-center font-rubik-bold text-lg">
                {isTracking ? "Stop Tracking" : "Start Tracking"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={handleMultiDay} 
              disabled={loading}
              className={`w-full py-4 px-6 rounded-2xl ${loading ? 'bg-gray-300' : 'bg-general-100 border border-gray-300'}`}
            >
              {loading ? (
                <View className="items-center">
                  <ActivityIndicator size="small" color="#0B2545" className="mb-2" />
                  <Text className="text-black-300 text-center font-rubik-bold text-lg">
                    Generating Plan...
                  </Text>
                  {loadingStatus && (
                    <>
                      <Text className="text-black-200 text-center font-rubik text-sm mt-1">
                        {loadingStatus.message}
                      </Text>
                      {typeof loadingStatus.progress === "number" && (
                        <View className="w-full mt-3">
                          <View className="h-2 bg-gray-200 rounded-full overflow-hidden">
                            <View
                              className="h-2 bg-primary-100 rounded-full"
                              style={{ width: `${Math.min(100, Math.max(0, loadingStatus.progress * 100))}%` }}
                            />
                          </View>
                          <Text className="text-black-200 text-xs text-center mt-1">
                            {Math.round((loadingStatus.progress || 0) * 100)}% complete
                          </Text>
                        </View>
                      )}
                    </>
                  )}
                </View>
              ) : (
                <Text className="text-black-300 text-center font-rubik-bold text-lg">
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

              {!loading && optimizedResult?.itinerary && (
                <View key={`optimized-${userLocation?.lat}-${userLocation?.lng}`}>
                  {renderItinerary(optimizedResult, "Optimized Itinerary")}
                </View>
              )}
              {!loading && weatherAdaptedResult?.itinerary && (
                <View key={`weather-${userLocation?.lat}-${userLocation?.lng}`}>
                  {renderItinerary(weatherAdaptedResult, "Weather-Adapted Itinerary")}
                </View>
              )}
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
              
              // Debug: Check what activities have canceled flag
              const activitiesWithCanceled = (selectedDay.itinerary || []).filter((a: any) => a.canceled === true);
              if (activitiesWithCanceled.length > 0) {
                console.log(`[UI] Day ${selectedDayIndex + 1} timeline - Found ${activitiesWithCanceled.length} activities with canceled flag:`, 
                  activitiesWithCanceled.map((a: any) => ({ name: a.name, canceled: a.canceled }))
                );
              }
              
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
                            
                            // Check if activity is canceled
                            // IMPORTANT: Only check item.canceled flag, NOT activityStatuses
                            // activityStatuses are loaded for currentTripDayIndex (Day 1), but timeline can show any day (selectedDayIndex)
                            // Using activityStatuses here would incorrectly mark Day 2/3 activities as canceled if their indices match Day 1
                            // The item.canceled flag is the source of truth stored in the itinerary data itself
                            const isCanceled = item.canceled === true;
                            
                            const top = getTimePosition(item.start_time, timelineStart, timelineEnd, timelineHeight);
                            const height = getDurationHeight(item.start_time, item.end_time, timelineStart, timelineEnd, timelineHeight);
                            const minHeight = 50; // Minimum visible height for each activity (compact view)
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
                              // Add extra spacing (12px instead of 8px) to prevent overlaps
                              const prevActualHeight = prevExpanded ? Math.max(minHeight, prevHeight) + 12 : minHeight + 12;
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
                                    className="p-2 rounded-lg bg-white border-2 shadow-sm"
                                    style={{
                                      borderLeftWidth: 4,
                                      borderLeftColor: isCanceled ? '#DC2626' : '#0B2545', // Red border if canceled
                                      opacity: isCanceled ? 0.6 : 1, // Dim canceled activities
                                    }}
                                  >
                                    {/* Place Photo - Always visible by default */}
                                    {item.photoUrl && (
                                      <View className="mb-1.5 rounded-lg overflow-hidden">
                                        <Image 
                                          source={{ uri: item.photoUrl }} 
                                          style={{ width: '100%', height: 60 }} 
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
                                        {/* Canceled Badge */}
                                        {isCanceled && (
                                          <View className="mt-1">
                                            <Text className="text-xs font-rubik-medium text-red-600">
                                              ✗ Canceled - Moved to future days
                                            </Text>
                                          </View>
                                        )}
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

                        {/* Activity Actions */}
                                        <View className="mt-3 flex-row gap-2 flex-wrap">
                          {/* Replace Button */}
                          <TouchableOpacity
                                            onPress={(e) => {
                                              e.stopPropagation();
                                              handleReplaceMultiDayItem(selectedDayIndex, item.originalIndex);
                                            }}
                                            className="px-3 py-2 rounded-lg bg-primary-100"
                          >
                            <Text className="text-white text-xs font-rubik-semibold">Replace</Text>
                          </TouchableOpacity>
                          
                          {/* Completion Buttons - Only show if tracking and on current day */}
                          {isTracking && selectedDayIndex === currentTripDayIndex && (() => {
                            const activityStatus = activityStatuses.find(s => s.activityIndex === item.originalIndex);
                            const status = activityStatus?.status || 'pending';
                            
                            if (status === 'completed') {
                              return (
                                <View className="px-3 py-2 rounded-lg bg-green-100 border border-green-300 flex-row items-center">
                                  <Text className="text-green-800 text-xs font-rubik-bold">✓ Completed</Text>
                                </View>
                              );
                            }
                            
                            if (status === 'skipped') {
                              return (
                                <View className="px-3 py-2 rounded-lg bg-gray-100 border border-gray-300">
                                  <Text className="text-gray-600 text-xs font-rubik-semibold">Skipped</Text>
                                </View>
                              );
                            }
                            
                            // Show complete and skip buttons for pending or in-progress activities
                            // Check if user is at location and within schedule time
                            const activityLat = item.lat ?? item.coordinates?.lat;
                            const activityLng = item.lng ?? item.coordinates?.lng;
                            const isAtLocation = userLocation && activityLat && activityLng
                              ? haversineMeters(userLocation, { lat: activityLat, lng: activityLng }) <= 120 // Within 120m
                              : false;
                            
                            // Check if within schedule time (uses currentTimeWithOverride which accounts for test override)
                            let isWithinTime = false;
                            if (item.start_time && item.end_time) {
                              try {
                                const nowMins = currentTimeWithOverride.getHours() * 60 + currentTimeWithOverride.getMinutes();
                                const startMins = timeToMinutes(item.start_time);
                                const endMins = timeToMinutes(item.end_time);
                                isWithinTime = nowMins >= startMins && nowMins <= endMins;
                              } catch {
                                isWithinTime = false;
                              }
                            }
                            
                            const canMarkComplete = isAtLocation && isWithinTime;
                            
                            return (
                              <>
                                <TouchableOpacity
                                  onPress={(e) => {
                                    e.stopPropagation();
                                    if (!canMarkComplete) {
                                      showAlert(
                                        "Cannot Mark Complete",
                                        `You must be at the location (within 120m) and within the scheduled time (${item.start_time || 'N/A'} - ${item.end_time || 'N/A'}) to mark this activity as complete.`,
                                        [{ text: "OK" }]
                                      );
                                      return;
                                    }
                                    markActivityComplete(item.originalIndex, false);
                                  }}
                                  className={`px-3 py-2 rounded-lg ${canMarkComplete ? 'bg-green-500' : 'bg-gray-400'}`}
                                  disabled={!canMarkComplete}
                                >
                                  <Text className="text-white text-xs font-rubik-bold">Mark Complete</Text>
                                </TouchableOpacity>
                                
                                <TouchableOpacity
                                  onPress={(e) => {
                                    e.stopPropagation();
                                    showAlert(
                                      "Skip Activity",
                                      `Skip "${item.name}"?`,
                                      [
                                        { text: "Cancel", style: "cancel" },
                                        {
                                          text: "Skip",
                                          style: "destructive",
                                          onPress: () => markActivityComplete(item.originalIndex, true)
                                        }
                                      ]
                                    );
                                  }}
                                  className="px-3 py-2 rounded-lg bg-gray-300"
                                >
                                  <Text className="text-gray-700 text-xs font-rubik-semibold">Skip</Text>
                                </TouchableOpacity>
                              </>
                            );
                          })()}
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
        </View>
      </ScrollView>
      <AlertComponent />
    </View>
  );
}
