// Testing tab for demo purposes
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useState } from "react";
import {
  Alert,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCustomAlert } from "@/components/CustomAlert";

export default function Testing() {
  // Custom alert
  const { showAlert, AlertComponent } = useCustomAlert();
  
  const [currentFatigue, setCurrentFatigue] = useState<number | null>(null);
  const [currentWeather, setCurrentWeather] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<string | null>(null);

  const loadCurrentStates = async () => {
    try {
      const fatigueData = await AsyncStorage.getItem("testFatigueOverride");
      const weatherData = await AsyncStorage.getItem("testWeatherOverride");
      const timeData = await AsyncStorage.getItem("testTimeOverride");
      
      if (fatigueData) {
        const data = JSON.parse(fatigueData);
        setCurrentFatigue(data.percentage);
      } else {
        setCurrentFatigue(null);
      }
      
      if (weatherData) {
        const data = JSON.parse(weatherData);
        setCurrentWeather(data.condition);
      } else {
        setCurrentWeather(null);
      }

      if (timeData) {
        const data = JSON.parse(timeData);
        const overrideDate = new Date(data.timestamp);
        const hours = overrideDate.getHours();
        const minutes = overrideDate.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        setCurrentTime(`${displayHours}:${String(minutes).padStart(2, '0')} ${ampm}`);
      } else {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        setCurrentTime(`Real: ${displayHours}:${String(minutes).padStart(2, '0')} ${ampm}`);
      }
    } catch (error) {
      console.error("Failed to load test states:", error);
    }
  };

  React.useEffect(() => {
    loadCurrentStates();
    const interval = setInterval(loadCurrentStates, 2000);
    return () => clearInterval(interval);
  }, []);

  const setFatigueLevel = async (level: "rested" | "exhausted") => {
    try {
      if (level === "rested") {
        await AsyncStorage.setItem(
          "testFatigueOverride",
          JSON.stringify({
            level: "Rested",
            percentage: 0,
            message: "You're feeling great and energized!",
            budgetRemaining: 2500,
            currentEE: 70,
            totalEEToday: 0,
          })
        );
        showAlert("Fatigue Reset", "Fatigue set to Rested (0%)");
      } else {
        await AsyncStorage.setItem(
          "testFatigueOverride",
          JSON.stringify({
            level: "Exhausted",
            percentage: 100,
            message: "Critical fatigue! Immediate rest is highly recommended.",
            budgetRemaining: 0,
            currentEE: 0,
            totalEEToday: 2500,
          })
        );
        showAlert("Fatigue Maximized", "Fatigue set to Exhausted (100%)");
      }
      await loadCurrentStates();
    } catch (error: any) {
      showAlert("Error", error.message);
    }
  };

  const clearFatigueOverride = async () => {
    try {
      await AsyncStorage.removeItem("testFatigueOverride");
      setCurrentFatigue(null);
      showAlert("Override Cleared", "Using real fatigue data now");
    } catch (error: any) {
      showAlert("Error", error.message);
    }
  };

  const setWeatherCondition = async (condition: string) => {
    try {
      await AsyncStorage.setItem(
        "testWeatherOverride",
        JSON.stringify({
          condition,
          temperature: condition === "Rain" ? 18 : condition === "Snow" ? -2 : 25,
          humidity: condition === "Rain" ? 85 : 60,
        })
      );
      showAlert("Weather Set", `Weather set to: ${condition}`);
      await loadCurrentStates();
    } catch (error: any) {
      showAlert("Error", error.message);
    }
  };

  const clearWeatherOverride = async () => {
    try {
      await AsyncStorage.removeItem("testWeatherOverride");
      setCurrentWeather(null);
      showAlert("Override Cleared", "Using real weather data now");
    } catch (error: any) {
      showAlert("Error", error.message);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1">
        <View className="px-5">
          {/* Header */}
          <View className="mt-5 mb-5">
            <Text className="text-2xl font-rubik-bold text-black-300">
              Testing Controls
            </Text>
            <Text className="text-sm text-black-200 font-rubik mt-1">
              Override real data for testing purposes
            </Text>
          </View>

          {/* Current States */}
          <View className="mb-6">
            <Text className="text-base font-rubik-bold text-black-300 mb-3">
              Current Test State
            </Text>
            
            <View className="bg-general-100 rounded-2xl p-4 mb-3">
              <View className="flex-row justify-between items-center">
                <Text className="text-sm text-black-200 font-rubik">
                  Fatigue Override
                </Text>
                <Text className="text-sm font-rubik-bold text-black-300">
                  {currentFatigue !== null ? `${currentFatigue}%` : "None (Real data)"}
                </Text>
              </View>
            </View>

            <View className="bg-general-100 rounded-2xl p-4 mb-3">
              <View className="flex-row justify-between items-center">
                <Text className="text-sm text-black-200 font-rubik">
                  Weather Override
                </Text>
                <Text className="text-sm font-rubik-bold text-black-300">
                  {currentWeather || "None (Real data)"}
                </Text>
              </View>
            </View>

            <View className="bg-indigo-100 rounded-2xl p-4">
              <View className="flex-row justify-between items-center">
                <Text className="text-sm text-black-200 font-rubik">
                  Current Time
                </Text>
                <Text className="text-sm font-rubik-bold text-indigo-800">
                  {currentTime || "Loading..."}
                </Text>
              </View>
            </View>
          </View>

          {/* Fatigue Controls */}
          <View className="mb-6">
            <Text className="text-base font-rubik-bold text-black-300 mb-3">
              Fatigue Testing
            </Text>
            
            <TouchableOpacity
              onPress={() => setFatigueLevel("rested")}
              className="bg-green-100 rounded-2xl p-4 mb-3 border border-green-300"
            >
              <Text className="text-center font-rubik-bold text-green-800">
                Reset Fatigue (0%)
              </Text>
              <Text className="text-center text-xs text-green-700 font-rubik mt-1">
                Set to Rested - fully energized
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setFatigueLevel("exhausted")}
              className="bg-red-100 rounded-2xl p-4 mb-3 border border-red-300"
            >
              <Text className="text-center font-rubik-bold text-red-800">
                Maximize Fatigue (100%)
              </Text>
              <Text className="text-center text-xs text-red-700 font-rubik mt-1">
                Set to Exhausted - critical fatigue
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={async () => {
                try {
                  await AsyncStorage.removeItem("lastFatigueAlertDismissed");
                  showAlert("Alert Reset", "Fatigue alerts will now trigger again");
                } catch (error: any) {
                  showAlert("Error", error.message);
                }
              }}
              className="bg-orange-100 rounded-2xl p-4 mb-3 border border-orange-300"
            >
              <Text className="text-center font-rubik-bold text-orange-800">
                Reset Alert Dismissal
              </Text>
              <Text className="text-center text-xs text-orange-700 font-rubik mt-1">
                Allow fatigue alerts to show again
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={clearFatigueOverride}
              className="bg-general-100 rounded-2xl p-4 mb-3 border border-gray-300"
            >
              <Text className="text-center font-rubik-semibold text-black-300">
                Clear Fatigue Override
              </Text>
              <Text className="text-center text-xs text-black-200 font-rubik mt-1">
                {currentFatigue !== null ? `Currently: ${currentFatigue}%` : "No override active"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Weather Controls */}
          <View className="mb-6">
            <Text className="text-base font-rubik-bold text-black-300 mb-3">
              Weather Testing
            </Text>
            
            <View className="flex-row gap-2 mb-2">
              <TouchableOpacity
                onPress={() => setWeatherCondition("Sunny")}
                className="flex-1 bg-yellow-100 rounded-2xl p-3 border border-yellow-300"
              >
                <Text className="text-center font-rubik-bold text-yellow-800 text-sm">
                  Sunny
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setWeatherCondition("Rain")}
                className="flex-1 bg-blue-100 rounded-2xl p-3 border border-blue-300"
              >
                <Text className="text-center font-rubik-bold text-blue-800 text-sm">
                  Rain
                </Text>
              </TouchableOpacity>
            </View>

            <View className="flex-row gap-2 mb-3">
              <TouchableOpacity
                onPress={() => setWeatherCondition("Snow")}
                className="flex-1 bg-cyan-100 rounded-2xl p-3 border border-cyan-300"
              >
                <Text className="text-center font-rubik-bold text-cyan-800 text-sm">
                  Snow
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setWeatherCondition("Thunderstorm")}
                className="flex-1 bg-purple-100 rounded-2xl p-3 border border-purple-300"
              >
                <Text className="text-center font-rubik-bold text-purple-800 text-sm">
                  Storm
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={clearWeatherOverride}
              className="bg-general-100 rounded-2xl p-4 mb-3 border border-gray-300"
            >
              <Text className="text-center font-rubik-semibold text-black-300">
                Clear Weather Override
              </Text>
              <Text className="text-center text-xs text-black-200 font-rubik mt-1">
                {currentWeather ? `Currently: ${currentWeather}` : "No override active"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={async () => {
                try {
                  await AsyncStorage.removeItem("lastWeatherAlertDismissed");
                  // Also clear "do not show again for today" flag
                  const today = new Date();
                  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                  await AsyncStorage.removeItem(`weatherDoNotShowAgain_${todayStr}`);
                  showAlert("Weather Alert Reset", "Weather alerts will now trigger again (cooldown and 'do not show again' flags cleared)");
                } catch (error: any) {
                  showAlert("Error", error.message);
                }
              }}
              className="bg-orange-100 rounded-2xl p-4 border border-orange-300"
            >
              <Text className="text-center font-rubik-bold text-orange-800">
                Reset Weather Alert Cooldown
              </Text>
              <Text className="text-center text-xs text-orange-700 font-rubik mt-1">
                Clear the 30-minute cooldown to test weather alerts again
              </Text>
            </TouchableOpacity>
          </View>

          {/* Location Testing */}
          <View className="mb-6">
            <Text className="text-base font-rubik-bold text-black-300 mb-3">
              Location Testing
            </Text>
            
            <TouchableOpacity
              onPress={async () => {
                try {
                  const tripPlan = await AsyncStorage.getItem("savedTripPlan");
                  if (!tripPlan) {
                    showAlert("No Trip Plan", "Please generate a trip plan first");
                    return;
                  }
                  
                  const plan = JSON.parse(tripPlan);
                  const today = new Date();
                  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                  const todayDay = plan.days?.find((d: any) => d.date === todayStr);
                  
                  if (!todayDay || !todayDay.itinerary || todayDay.itinerary.length === 0) {
                    showAlert("No Activities", "No activities scheduled for today");
                    return;
                  }
                  
                  // Get first activity's location
                  const firstActivity = todayDay.itinerary[0];
                  const lat = firstActivity.lat ?? firstActivity.coordinates?.lat;
                  const lng = firstActivity.lng ?? firstActivity.coordinates?.lng;
                  
                  if (!lat || !lng) {
                    showAlert("Error", "Activity doesn't have location data");
                    return;
                  }
                  
                  // Set location override
                  await AsyncStorage.setItem(
                    "testLocationOverride",
                    JSON.stringify({ lat, lng })
                  );
                  
                  showAlert(
                    "Location Set",
                    `Location set to first activity: ${firstActivity.name}\nLat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`
                  );
                } catch (error: any) {
                  showAlert("Error", error.message);
                }
              }}
              className="bg-purple-100 rounded-2xl p-4 mb-3 border border-purple-300"
            >
              <Text className="text-center font-rubik-bold text-purple-800">
                Set Location to Current Activity
              </Text>
              <Text className="text-center text-xs text-purple-700 font-rubik mt-1">
                Matches your location to the first scheduled activity
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={async () => {
                try {
                  const tripPlan = await AsyncStorage.getItem("savedTripPlan");
                  if (!tripPlan) {
                    showAlert("No Trip Plan", "Please generate a trip plan first");
                    return;
                  }
                  
                  const plan = JSON.parse(tripPlan);
                  const today = new Date();
                  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                  const todayDay = plan.days?.find((d: any) => d.date === todayStr);
                  
                  if (!todayDay || !todayDay.itinerary || todayDay.itinerary.length === 0) {
                    showAlert("No Activities", "No activities scheduled for today");
                    return;
                  }
                  
                  // Get next activity (second activity, or first if only one exists)
                  // This simulates moving from current activity to next
                  const nextActivityIdx = todayDay.itinerary.length > 1 ? 1 : 0;
                  const nextActivity = todayDay.itinerary[nextActivityIdx];
                  const lat = nextActivity.lat ?? nextActivity.coordinates?.lat;
                  const lng = nextActivity.lng ?? nextActivity.coordinates?.lng;
                  
                  if (!lat || !lng) {
                    showAlert("Error", "Next activity doesn't have location data");
                    return;
                  }
                  
                  // Set location override to next activity
                  await AsyncStorage.setItem(
                    "testLocationOverride",
                    JSON.stringify({ lat, lng })
                  );
                  
                  showAlert(
                    "Location Set to Next Activity",
                    `Location set to: ${nextActivity.name}\nLat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}\n\nThis simulates moving to the next planned location for testing completion detection.`
                  );
                } catch (error: any) {
                  showAlert("Error", error.message);
                }
              }}
              className="bg-blue-100 rounded-2xl p-4 mb-3 border border-blue-300"
            >
              <Text className="text-center font-rubik-bold text-blue-800">
                Move to Next Planned Location
              </Text>
              <Text className="text-center text-xs text-blue-700 font-rubik mt-1">
                Sets location to next activity to test leaving detection
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={async () => {
                try {
                  await AsyncStorage.removeItem("testLocationOverride");
                  // Force a state update by setting a timestamp
                  await AsyncStorage.setItem("testLocationCleared", Date.now().toString());
                  showAlert("Override Cleared", "Using real GPS location now. Return to Explore tab to see update.");
                } catch (error: any) {
                  showAlert("Error", error.message);
                }
              }}
              className="bg-general-100 rounded-2xl p-4 border border-gray-300"
            >
              <Text className="text-center font-rubik-semibold text-black-300">
                Clear Location Override
              </Text>
            </TouchableOpacity>
          </View>

          {/* Time Testing */}
          <View className="mb-6">
            <Text className="text-base font-rubik-bold text-black-300 mb-3">
              Time Testing
            </Text>
            
            <TouchableOpacity
              onPress={async () => {
                try {
                  // Set time to 9:00 AM
                  const now = new Date();
                  now.setHours(9, 0, 0, 0);
                  
                  await AsyncStorage.setItem(
                    "testTimeOverride",
                    JSON.stringify({ timestamp: now.toISOString() })
                  );
                  
                  showAlert(
                    "Time Set",
                    `Time set to 9:00 AM for testing schedule matching`
                  );
                } catch (error: any) {
                  showAlert("Error", error.message);
                }
              }}
              className="bg-indigo-100 rounded-2xl p-4 mb-3 border border-indigo-300"
            >
              <Text className="text-center font-rubik-bold text-indigo-800">
                Set Time to 9:00 AM
              </Text>
              <Text className="text-center text-xs text-indigo-700 font-rubik mt-1">
                Forces current time to 9am for schedule testing
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={async () => {
                try {
                  await AsyncStorage.removeItem("testTimeOverride");
                  showAlert("Override Cleared", "Using real system time now");
                } catch (error: any) {
                  showAlert("Error", error.message);
                }
              }}
              className="bg-general-100 rounded-2xl p-4 border border-gray-300"
            >
              <Text className="text-center font-rubik-semibold text-black-300">
                Clear Time Override
              </Text>
            </TouchableOpacity>
          </View>

          {/* Instructions */}
          <View className="bg-general-100 rounded-2xl p-4 mb-6">
            <Text className="text-sm font-rubik-bold text-black-300 mb-2">
              How to Test
            </Text>
            <Text className="text-xs text-black-200 font-rubik mb-1">
              1. Generate a multi-day plan in Explore tab
            </Text>
            <Text className="text-xs text-black-200 font-rubik mb-1">
              2. Start tracking
            </Text>
            <Text className="text-xs text-black-200 font-rubik mb-1">
              3. Use buttons above to override fatigue/weather/location
            </Text>
            <Text className="text-xs text-black-200 font-rubik mb-1">
              4. Check Explore tab to see auto-adjustments
            </Text>
            <Text className="text-xs text-black-200 font-rubik italic mt-2">
              Note: Overrides persist until cleared
            </Text>
          </View>
        </View>
      </ScrollView>
      <AlertComponent />
    </SafeAreaView>
  );
}

