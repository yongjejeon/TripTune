// screens/Health.tsx - Heart Rate Monitoring
import { useHeartRate } from "@/contexts/HeartRateContext";
import {
  calculateFatigue,
  calculateFatigueWithoutHR,
  type UserProfile,
  type FatigueData,
  FatigueLevel,
} from "@/lib/fatigueCalculator";
import { readHeartRateSeries } from "@/lib/health";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCustomAlert } from "@/components/CustomAlert";

export default function Health() {
  // Custom alert
  const { showAlert, AlertComponent } = useCustomAlert();
  
  const router = useRouter();
  const { heartRate, isMonitoring, error, refreshNow } = useHeartRate();
  const [refreshing, setRefreshing] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const [history, setHistory] = React.useState<{ bpm: number; at: string }[]>([]);
  const [userProfile, setUserProfile] = React.useState<UserProfile | null>(null);
  const [fatigueData, setFatigueData] = React.useState<FatigueData | null>(null);
  const [isTrackingFatigue, setIsTrackingFatigue] = React.useState(false);

  // Track if we just triggered a force sync
  const [forceSyncTriggered, setForceSyncTriggered] = React.useState(false);

  // Load user profile and refresh heart rate when screen is focused
  useFocusEffect(
    useCallback(() => {
      loadUserProfile();
      
      // If returning from a force sync, do an aggressive refresh
      if (forceSyncTriggered) {
        console.log("[Fatigue] Returning from force sync, doing cache-busting refresh...");
        setForceSyncTriggered(false);
        
        // Do multiple refresh attempts at different intervals
        const doAggressiveRefresh = async () => {
          // First attempt immediately
          await refreshNow();
          
          // Second attempt with cache busting after 1 second
          setTimeout(async () => {
            console.log("[Fatigue] Second refresh attempt...");
            await refreshNow();
          }, 1000);
          
          // Third attempt after 3 seconds
          setTimeout(async () => {
            console.log("[Fatigue] Third refresh attempt...");
            await refreshNow();
          }, 3000);
          
          // Final attempt after 5 seconds
          setTimeout(async () => {
            console.log("[Fatigue] Final refresh attempt...");
            await refreshNow();
          }, 5000);
        };
        
        doAggressiveRefresh();
      } else {
        // Normal refresh
        refreshNow();
      }
    }, [refreshNow, forceSyncTriggered])
  );

  // Load tracking state on mount (shared with explore.tsx)
  React.useEffect(() => {
    loadTrackingState();
    const interval = setInterval(loadTrackingState, 2000); // Poll for changes from explore
    return () => clearInterval(interval);
  }, []);

  // Calculate fatigue whenever heart rate changes (only if tracking is enabled)
  React.useEffect(() => {
    if (heartRate.bpm && userProfile && isTrackingFatigue) {
      calculateFatigueData();
      saveFatigueData();
    }
  }, [heartRate.bpm, userProfile, isTrackingFatigue]);

  // Check for test overrides periodically and calculate fatigue
  React.useEffect(() => {
    const checkTestOverride = async () => {
      try {
        const testOverride = await AsyncStorage.getItem("testFatigueOverride");
        if (testOverride) {
          const overrideData = JSON.parse(testOverride);
          setFatigueData(overrideData);
        } else if (userProfile && isTrackingFatigue) {
          // Recalculate (works with or without HR data)
          calculateFatigueData();
        }
      } catch (err) {
        console.error("[Fatigue] Error checking test override:", err);
      }
    };
    
    checkTestOverride();
    const interval = setInterval(checkTestOverride, 2000); // Check every 2s for testing
    return () => clearInterval(interval);
  }, [heartRate.bpm, userProfile, isTrackingFatigue]);

  const loadTrackingState = async () => {
    try {
      const tracking = await AsyncStorage.getItem("isTracking");
      setIsTrackingFatigue(tracking === "true");
    } catch (err) {
      console.error("[Fatigue] Error loading tracking state:", err);
    }
  };

  const saveFatigueData = async () => {
    if (fatigueData) {
      try {
        await AsyncStorage.setItem("currentFatigue", JSON.stringify(fatigueData));
      } catch (err) {
        console.error("[Fatigue] Error saving fatigue data:", err);
      }
    }
  };

  const loadUserProfile = async () => {
    try {
      const bioData = await AsyncStorage.getItem("userBiometrics");
      if (bioData) {
        const bio = JSON.parse(bioData);
        const profile: UserProfile = {
          gender: bio.gender === "female" ? "female" : "male",
          age: Number(bio.age) || 30,
          weight: Number(bio.weight) || 70,
          height: Number(bio.height) || 170,
        };
        setUserProfile(profile);
        console.log("[Fatigue] Loaded user profile:", profile);
      } else {
        console.log("[Fatigue] No user profile found");
      }
    } catch (err) {
      console.error("[Fatigue] Error loading profile:", err);
    }
  };

  const calculateFatigueData = async () => {
    // Check for test override first
    try {
      const testOverride = await AsyncStorage.getItem("testFatigueOverride");
      if (testOverride) {
        const overrideData = JSON.parse(testOverride);
        setFatigueData(overrideData);
        console.log("[Fatigue] Using test override:", overrideData);
        return;
      }
    } catch (err) {
      console.error("[Fatigue] Error checking test override:", err);
    }
    
    // Use real calculation
    if (!userProfile) return;

    try {
      // Estimate hours awake (for now, simple calculation based on time of day)
      const now = new Date();
      const hoursAwake = now.getHours() >= 6 ? now.getHours() - 6 : 0; // Assume wake up at 6 AM

      let fatigue: FatigueData;
      
      if (heartRate.bpm) {
        // Use heart rate-based calculation
        fatigue = calculateFatigue(
          heartRate.bpm,
          userProfile,
          "light", // Default to light travel activity
          Math.max(1, hoursAwake)
        );
        console.log("[Fatigue] Calculated with HR:", fatigue);
      } else {
        // No heart rate data - use REE-based estimation with default walking HR
        fatigue = calculateFatigueWithoutHR(
          userProfile,
          "light", // Default to light travel activity
          Math.max(1, hoursAwake)
        );
        console.log("[Fatigue] Calculated WITHOUT HR (using REE):", fatigue);
      }

      setFatigueData(fatigue);
    } catch (err) {
      console.error("[Fatigue] Calculation error:", err);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshNow();
    await loadUserProfile();
    setRefreshing(false);
  };

  const checkMeasurementHistory = async () => {
    try {
      // Get last 3 hours of data
      const data = await readHeartRateSeries(180);
      setHistory(data);
      setShowHistory(true);

      // Console log ALL measurements for debugging
      console.log("=== MEASUREMENT HISTORY (Last 3 hours) ===");
      console.log(`Total measurements: ${data.length}`);
      
      if (data.length > 0) {
        console.log("\nAll measurements (newest first):");
        data.forEach((measurement, index) => {
          const time = new Date(measurement.at);
          const now = new Date();
          const minutesAgo = Math.round((now.getTime() - time.getTime()) / 1000 / 60);
          console.log(
            `[${index + 1}] ${measurement.bpm} BPM at ${time.toLocaleTimeString()} (${minutesAgo}m ago)`
          );
        });

        // Calculate and log intervals
        console.log("\nIntervals between measurements:");
        const intervals: number[] = [];
        for (let i = 1; i < data.length; i++) {
          const diff = new Date(data[i - 1].at).getTime() - new Date(data[i].at).getTime();
          const intervalMinutes = diff / 1000 / 60;
          intervals.push(intervalMinutes);
          console.log(`  ${data[i - 1].bpm} → ${data[i].bpm}: ${intervalMinutes.toFixed(1)} minutes`);
        }

        const avgInterval = intervals.length > 0
          ? intervals.reduce((a, b) => a + b, 0) / intervals.length
          : 0;
        
        const minInterval = intervals.length > 0 ? Math.min(...intervals) : 0;
        const maxInterval = intervals.length > 0 ? Math.max(...intervals) : 0;

        console.log(`\nInterval stats:`);
        console.log(`  Average: ${avgInterval.toFixed(1)} minutes`);
        console.log(`  Min: ${minInterval.toFixed(1)} minutes`);
        console.log(`  Max: ${maxInterval.toFixed(1)} minutes`);
        console.log("==========================================\n");

        showAlert(
          "Measurement History",
          `Found ${data.length} measurements in last 3 hours\n\n` +
          `Average interval: ${avgInterval.toFixed(1)} minutes\n` +
          `Min: ${minInterval.toFixed(1)}m | Max: ${maxInterval.toFixed(1)}m\n\n` +
          (avgInterval > 15
            ? "⚠️ Measurements are infrequent. Enable 'Measure frequently' on your watch."
            : avgInterval > 5
            ? "✓ Continuous monitoring appears to be working"
            : "✓ Frequent measurements detected") +
          "\n\nCheck console logs for detailed timestamps",
          [{ text: "OK" }]
        );
      } else {
        console.log("No measurements found in last 3 hours");
        console.log("==========================================\n");
        showAlert(
          "No Automatic Measurements",
          "No heart rate data found in the last 3 hours.\n\nThis means your watch is NOT measuring automatically.\n\nPlease enable 'Continuous measurement' on your Galaxy Watch.",
          [{ text: "OK" }]
        );
      }
    } catch (err: any) {
      console.error("Error checking measurement history:", err);
      showAlert("Error", err.message);
    }
  };

  const getAgeInSeconds = () => {
    if (!heartRate.timestamp) return null;
    return Math.round(
      (Date.now() - new Date(heartRate.timestamp).getTime()) / 1000
    );
  };

  const getDataFreshness = () => {
    const age = getAgeInSeconds();
    if (age === null) return { text: "No data", color: "#9CA3AF" };
    if (age < 300) return { text: "Fresh", color: "#10B981" }; // < 5 min
    if (age < 900) return { text: "Recent", color: "#F59E0B" }; // < 15 min
    return { text: "Old", color: "#EF4444" };
  };

  const freshness = getDataFreshness();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View className="px-5">
          {/* Header */}
          <View className="mt-5 mb-5">
            <Text className="text-2xl font-rubik-bold text-black-300 mb-4">
              Health
            </Text>
            
            {/* Large BPM Display */}
            <View className="items-center py-6 mb-4">
              {heartRate.bpm ? (
                <>
                  <Text className="text-7xl font-rubik-bold text-primary-300 mb-2">
                    {heartRate.bpm}
                  </Text>
                  <Text className="text-lg text-black-200 font-rubik">
                    beats per minute
                  </Text>
                </>
              ) : (
                <>
                  <Text className="text-7xl font-rubik-bold text-gray-300 mb-2">
                    --
                  </Text>
                  <Text className="text-lg text-black-200 font-rubik">
                    No data
                  </Text>
                </>
              )}
            </View>
          </View>

          {/* Heart Rate Info */}
          {heartRate.timestamp && (
            <View className="bg-general-100 rounded-2xl p-4 mb-4">
              <View className="flex-row justify-between items-center mb-2">
                <Text className="text-sm text-black-200 font-rubik">
                  Last Measurement
                </Text>
                <Text className="text-sm text-black-300 font-rubik-medium">
                  {new Date(heartRate.timestamp).toLocaleTimeString()}
                </Text>
              </View>
              <View className="flex-row justify-between items-center">
                <Text className="text-sm text-black-200 font-rubik">
                  Status
                </Text>
                <View className="flex-row items-center">
                  <View
                    className="w-2 h-2 rounded-full mr-2"
                    style={{ backgroundColor: freshness.color }}
                  />
              <Text 
                    className="text-sm font-rubik-medium"
                    style={{ color: freshness.color }}
                  >
                    {freshness.text}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Fatigue Status */}
          {!isTrackingFatigue && (
            <View className="bg-general-100 rounded-2xl p-4 mb-4">
              <Text className="text-sm font-rubik-bold text-black-300 mb-1">
                Fatigue Tracking Inactive
              </Text>
              <Text className="text-xs text-black-200 font-rubik">
                Go to Explore tab and tap "Start Tracking" to monitor fatigue
              </Text>
            </View>
          )}

          {/* Fatigue Display - Only when tracking */}
          {isTrackingFatigue && fatigueData && (
            <View className="mb-4">
              <View className="bg-general-100 rounded-2xl p-4 mb-3">
                <View className="flex-row justify-between items-center mb-3">
                  <Text className="text-lg font-rubik-bold text-black-300">
                    Fatigue Level
                  </Text>
                  <Text className="text-2xl font-rubik-bold text-primary-300">
                    {fatigueData.percentage}%
                  </Text>
                </View>
                <View className="flex-row items-center mb-2">
                  <View
                    className="w-3 h-3 rounded-full mr-2"
                    style={{
                      backgroundColor:
                        fatigueData.level === FatigueLevel.RESTED
                          ? "#10B981"
                          : fatigueData.level === FatigueLevel.LIGHT
                          ? "#3B82F6"
                          : fatigueData.level === FatigueLevel.MODERATE
                          ? "#F59E0B"
                          : fatigueData.level === FatigueLevel.HIGH
                          ? "#F97316"
                          : "#EF4444",
                    }}
                  />
                  <Text className="text-base font-rubik-medium text-black-300">
                    {fatigueData.level}
                  </Text>
                </View>
                <Text className="text-sm text-black-200 font-rubik">
                  {fatigueData.message}
              </Text>
            </View>

              <View className="bg-general-100 rounded-2xl p-4">
                <Text className="text-sm font-rubik-bold text-black-300 mb-3">
                  Energy Today
                </Text>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-xs text-black-200 font-rubik">Current Rate</Text>
                  <Text className="text-xs text-black-300 font-rubik-medium">
                    {fatigueData.currentEE} kcal/hr
                  </Text>
                </View>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-xs text-black-200 font-rubik">Spent</Text>
                  <Text className="text-xs text-black-300 font-rubik-medium">
                    {fatigueData.totalEEToday} kcal
                  </Text>
                </View>
            <View className="flex-row justify-between">
                  <Text className="text-xs text-black-200 font-rubik">Remaining</Text>
                  <Text className="text-xs text-green-600 font-rubik-bold">
                    {fatigueData.budgetRemaining} kcal
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Errors/Warnings */}
          {!userProfile && isTrackingFatigue && (
            <View className="bg-general-100 rounded-2xl p-4 mb-4">
              <Text className="text-sm font-rubik-bold text-black-300 mb-1">
                Profile Required
              </Text>
              <Text className="text-xs text-black-200 font-rubik">
                Complete your profile to calculate fatigue
              </Text>
            </View>
          )}

          {error && (
            <View className="bg-general-100 rounded-2xl p-4 mb-4">
              <Text className="text-sm font-rubik-bold text-black-300 mb-1">
                Connection Issue
              </Text>
              <Text className="text-xs text-black-200 font-rubik">{error}</Text>
            </View>
          )}

          {/* Info */}
          <View className="bg-general-100 rounded-2xl p-4 mb-4">
            <Text className="text-sm font-rubik-bold text-black-300 mb-2">
              Troubleshooting
            </Text>
            <Text className="text-xs text-black-200 font-rubik-bold mb-2">
              If data seems stuck:
            </Text>
            <Text className="text-xs text-black-200 font-rubik mb-1">
              1. Check your watch - is it measuring?
            </Text>
            <Text className="text-xs text-black-200 font-rubik mb-1">
              2. Open Samsung Health app on phone
            </Text>
            <Text className="text-xs text-black-200 font-rubik mb-1">
              3. Verify watch is synced (should show recent data)
            </Text>
            <Text className="text-xs text-black-200 font-rubik mb-2">
              4. Use "Force Sync" button below
            </Text>
            <Text className="text-xs text-black-200 font-rubik-bold mb-2 mt-2">
              For automatic syncing:
            </Text>
            <Text className="text-xs text-black-200 font-rubik mb-1">
              • Settings → Apps → Samsung Health → Battery → Unrestricted
            </Text>
            <Text className="text-xs text-black-200 font-rubik mb-1">
              • Settings → Apps → Health Connect → Battery → Unrestricted
            </Text>
            <Text className="text-xs text-black-200 font-rubik italic mt-2">
              Note: Even with proper setup, updates may take 1-5 minutes
            </Text>
          </View>

          {/* Measurement History */}
          {showHistory && history.length > 0 && (
            <View className="bg-white border border-gray-200 rounded-2xl p-4 mb-5">
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-base font-rubik-bold text-black-300">
                  Recent Measurements
                </Text>
                <TouchableOpacity onPress={() => setShowHistory(false)}>
                  <Text className="text-sm text-primary-300 font-rubik-medium">
                    Hide
                  </Text>
                </TouchableOpacity>
        </View>
              <ScrollView className="max-h-48">
                {history.slice(0, 10).map((item, index) => {
                  const time = new Date(item.at);
                  const now = new Date();
                  const minutesAgo = Math.round((now.getTime() - time.getTime()) / 1000 / 60);
                  
                  return (
                    <View key={index} className="flex-row justify-between py-2 border-b border-gray-100">
                      <Text className="text-sm text-black-300 font-rubik-medium">
                        {item.bpm} BPM
                      </Text>
                      <Text className="text-sm text-black-200 font-rubik">
                        {time.toLocaleTimeString()} ({minutesAgo}m ago)
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
              {history.length > 10 && (
                <Text className="text-xs text-gray-500 font-rubik mt-2 text-center">
                  Showing 10 of {history.length} measurements
                </Text>
              )}
            </View>
          )}

          {/* Actions */}
        <TouchableOpacity
          onPress={async () => {
            try {
                const { triggerSamsungHealthSync } = await import("@/lib/health");
                
                showAlert(
                  "Force Data Refresh",
                  "This will open Health Connect settings.\n\n1. Check your permissions (should be enabled)\n2. Press BACK to return\n3. Data will auto-refresh\n\nThis forces Health Connect to check for new data from Samsung Health.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Open Health Connect",
                      onPress: async () => {
                        setForceSyncTriggered(true);
                        await triggerSamsungHealthSync();
                      }
                    }
                  ]
                );
              } catch (error: any) {
                showAlert("Error", error.message);
              }
            }}
            className="bg-primary-100 rounded-2xl p-4 mb-3"
          >
            <Text className="text-sm font-rubik-semibold text-white text-center">
              Force Sync Now (if stuck)
            </Text>
          </TouchableOpacity>

        <TouchableOpacity
            onPress={checkMeasurementHistory}
            className="bg-general-100 rounded-2xl p-4 mb-3"
          >
            <Text className="text-sm font-rubik-semibold text-black-300 text-center">
              View Measurement History
          </Text>
        </TouchableOpacity>

          {(!isMonitoring || error) && (
        <TouchableOpacity
              onPress={() => router.push("/(root)/health-setup")}
              className="bg-general-100 rounded-2xl p-4 mb-3"
        >
              <Text className="text-sm font-rubik-semibold text-black-300 text-center">
                Check Connection
          </Text>
        </TouchableOpacity>
          )}

          <View className="mt-2 mb-6">
            <Text className="text-xs text-black-200 font-rubik text-center">
              Pull down to refresh
          </Text>
        </View>
      </View>
      </ScrollView>
      <AlertComponent />
    </SafeAreaView>
  );
}
