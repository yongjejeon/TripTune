// Health Connect Setup Flow
import {
  checkHealthConnectAvailability,
  ensureHCReady,
  openAppSettings,
  testPermission,
} from "@/lib/health";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
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
import { useCustomAlert } from "@/components/CustomAlert";

const steps = [
  {
    id: 1,
    title: "Connect Galaxy Watch",
    description: "Ensure your Galaxy Watch is paired via Bluetooth",
    icon: require("@/assets/icons/heart.png"),
  },
  {
    id: 2,
    title: "Grant Permissions",
    description: "Allow TripTune to read your heart rate data",
    icon: require("@/assets/icons/shield.png"),
  },
  {
    id: 3,
    title: "Test Connection",
    description: "Verify everything is working correctly",
    icon: require("@/assets/icons/info.png"),
  },
];

export default function HealthSetup() {
  // Custom alert
  const { showAlert, AlertComponent } = useCustomAlert();
  
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [availability, setAvailability] = useState<any>(null);
  const [hasPermission, setHasPermission] = useState(false);

  useEffect(() => {
    checkAvailability();
  }, []);

  const checkAvailability = async () => {
    const result = await checkHealthConnectAvailability();
    setAvailability(result);
    if (!result.available) {
      showAlert(
        "Health Connect Not Available",
        result.message + "\n\nPlease install Health Connect from Google Play Store.",
        [{ text: "OK" }]
      );
    }
  };

  const handleStep1Continue = () => {
    setCurrentStep(2);
  };

  const handleStep2RequestPermission = async () => {
    setLoading(true);
    try {
      await ensureHCReady();
      const granted = await testPermission();
      setHasPermission(granted);
      
      if (granted) {
        setCurrentStep(3);
      } else {
        showAlert(
          "Permission Required",
          "Please grant the permission in Settings",
          [
            {
              text: "Open Settings",
              onPress: () => openAppSettings(),
            },
            { text: "Cancel" },
          ]
        );
      }
    } catch (error: any) {
      if (error.message.includes("denied")) {
        showAlert(
          "Permission Denied",
          "Go to Settings → Apps → TripTune → Permissions and enable 'Physical activity'",
          [
            {
              text: "Open Settings",
              onPress: () => openAppSettings(),
            },
            { text: "Cancel" },
          ]
        );
      } else {
        showAlert("Error", error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStep3Test = async () => {
    setLoading(true);
    try {
      const granted = await testPermission();
      
      if (granted) {
        showAlert(
          "Connection Successful!",
          "Your Galaxy Watch is connected and heart rate monitoring is active.",
          [
            {
              text: "Continue to App",
              onPress: () => router.replace("/(root)/(tabs)"),
            },
          ]
        );
      } else {
        showAlert(
          "Connection Failed",
          "Please check your permissions and try again.",
          [
            {
              text: "Open Settings",
              onPress: () => openAppSettings(),
            },
            { text: "Retry", onPress: handleStep3Test },
          ]
        );
      }
    } catch (error: any) {
      showAlert("Test Failed", error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    showAlert(
      "Skip Setup?",
      "You can set up Health Connect later, but some features will be unavailable.",
      [
        {
          text: "Skip",
          style: "destructive",
          onPress: () => router.replace("/(root)/(tabs)"),
        },
        { text: "Continue Setup" },
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1">
        <View className="px-5 py-6">
          {/* Header */}
          <View className="mb-8">
            <Text className="text-3xl font-rubik-bold text-black-300 mb-2">
              Connect Your Galaxy Watch
            </Text>
            <Text className="text-base text-black-200 font-rubik">
              Set up heart rate monitoring to get personalized itinerary recommendations
            </Text>
          </View>

          {/* Progress Steps */}
          <View className="mb-8">
            <View className="flex-row justify-between mb-4">
              {steps.map((step) => (
                <View key={step.id} className="flex-1 items-center">
                  <View
                    className={`w-12 h-12 rounded-full items-center justify-center mb-2 ${
                      currentStep === step.id
                        ? "bg-primary-300"
                        : currentStep > step.id
                        ? "bg-green-500"
                        : "bg-gray-200"
                    }`}
                  >
                    {currentStep > step.id ? (
                      <Text className="text-white text-xl">✓</Text>
                    ) : (
                      <Image
                        source={step.icon}
                        className="w-6 h-6"
                        style={{
                          tintColor:
                            currentStep === step.id ? "#FFFFFF" : "#9CA3AF",
                        }}
                      />
                    )}
                  </View>
                  <Text
                    className={`text-xs text-center font-rubik ${
                      currentStep === step.id
                        ? "text-primary-300 font-rubik-medium"
                        : currentStep > step.id
                        ? "text-green-600 font-rubik-medium"
                        : "text-gray-400"
                    }`}
                  >
                    {step.title}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* Step Content */}
          <View className="bg-general-100 p-5 rounded-2xl mb-6">
            {currentStep === 1 && (
              <View>
                <Text className="text-xl font-rubik-bold text-black-300 mb-3">
                  Step 1: Connect Galaxy Watch
                </Text>
                <Text className="text-base text-black-200 font-rubik mb-4">
                  Make sure your Galaxy Watch is:
                </Text>
                <View className="ml-4 mb-4">
                  <Text className="text-base text-black-200 font-rubik mb-2">
                    • Paired with your phone via Bluetooth
                  </Text>
                  <Text className="text-base text-black-200 font-rubik mb-2">
                    • Running Samsung Health app
                  </Text>
                  <Text className="text-base text-black-200 font-rubik mb-2">
                    • Continuous heart rate monitoring enabled
                  </Text>
                </View>
                
                <View className="bg-primary-100 p-4 rounded-xl mb-4">
                  <Text className="text-sm font-rubik-semibold text-primary-300 mb-2">
                    IMPORTANT: Set measurement to "Every 10 minutes"
                  </Text>
                  <Text className="text-sm text-black-200 font-rubik mb-2">
                    On your watch: Samsung Health → Settings → Heart rate
                  </Text>
                  <Text className="text-sm text-black-200 font-rubik mb-2">
                    • Set to "Measure every 10 minutes" (NOT continuous)
                  </Text>
                  <Text className="text-sm text-black-200 font-rubik">
                    • This ensures data syncs properly to your phone
                  </Text>
                </View>
                
                <View className="bg-yellow-50 p-3 rounded-xl mb-4 border border-yellow-200">
                  <Text className="text-xs text-yellow-900 font-rubik">
                    ⚠️ "Continuous measurement" doesn't sync reliably to apps. Use "Every 10 minutes" for best results.
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={handleStep1Continue}
                  className="bg-primary-300 py-4 rounded-full items-center"
                >
                  <Text className="text-white text-base font-rubik-bold">
                    Watch is Connected
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {currentStep === 2 && (
              <View>
                <Text className="text-xl font-rubik-bold text-black-300 mb-3">
                  Step 2: Grant Permissions
                </Text>
                <Text className="text-base text-black-200 font-rubik mb-4">
                  TripTune needs permission to read your heart rate data from Health
                  Connect.
                </Text>

                {availability && !availability.available && (
                  <View className="bg-red-50 p-4 rounded-xl mb-4">
                    <Text className="text-sm text-red-800 font-rubik-semibold mb-2">
                      Health Connect Not Available
                    </Text>
                    <Text className="text-sm text-red-700 font-rubik">
                      {availability.message}
                    </Text>
                  </View>
                )}

                <View className="bg-general-200 p-4 rounded-xl mb-4">
                  <Text className="text-sm text-black-200 font-rubik">
                    When you tap the button below, you'll be asked to grant permission
                    to read heart rate data. This data stays on your device and is used
                    only to provide personalized recommendations.
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={handleStep2RequestPermission}
                  disabled={loading || (availability && !availability.available)}
                  className={`py-4 rounded-full items-center mb-3 ${
                    loading || (availability && !availability.available)
                      ? "bg-gray-300"
                      : "bg-primary-300"
                  }`}
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white text-base font-rubik-bold">
                      Grant Permission
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => openAppSettings()}
                  className="py-3 rounded-full items-center border border-primary-300"
                >
                  <Text className="text-primary-300 text-sm font-rubik-semibold">
                    Open Settings Manually
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {currentStep === 3 && (
              <View>
                <Text className="text-xl font-rubik-bold text-black-300 mb-3">
                  Step 3: Test Connection
                </Text>
                <Text className="text-base text-black-200 font-rubik mb-4">
                  Let's verify that TripTune can read your heart rate data.
                </Text>

                {hasPermission && (
                  <View className="bg-green-50 p-4 rounded-xl mb-4">
                    <Text className="text-sm font-rubik-bold text-green-800 mb-2">
                      Permission Granted!
                    </Text>
                    <Text className="text-sm text-green-700 font-rubik">
                      TripTune can now read your heart rate data.
                    </Text>
                  </View>
                )}

                <View className="bg-general-200 p-4 rounded-xl mb-4">
                  <Text className="text-sm text-black-200 font-rubik mb-2">
                    This will attempt to read your most recent heart rate measurement. If
                    you haven't measured recently, you can:
                  </Text>
                  <Text className="text-sm text-black-200 font-rubik ml-3">
                    • Measure manually on your watch now
                  </Text>
                  <Text className="text-sm text-black-200 font-rubik ml-3">
                    • Wait for automatic measurement (every 10 min)
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={handleStep3Test}
                  disabled={loading}
                  className={`py-4 rounded-full items-center mb-3 ${
                    loading ? "bg-gray-300" : "bg-primary-300"
                  }`}
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white text-base font-rubik-bold">
                      Test Connection
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Skip Button */}
          <TouchableOpacity onPress={handleSkip} className="py-3 items-center">
            <Text className="text-black-200 text-sm font-rubik">Skip for now</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <AlertComponent />
    </SafeAreaView>
  );
}

