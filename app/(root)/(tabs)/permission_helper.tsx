// Permission Helper Screen
import { 
  openHCSettings, 
  openAppSettings, 
  checkHealthConnectAvailability,
  testPermission 
} from "@/lib/health";
import React, { useState } from "react";
import {
  Alert,
  Linking,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function PermissionHelper() {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    hasPermission: boolean;
    availability: any;
  } | null>(null);

  const openHealthConnectInSettings = async () => {
    try {
      // Try to open Health Connect directly
      await openHCSettings();
    } catch (error) {
      // If that fails, open Android settings
      Alert.alert(
        "Opening Settings",
        "If Health Connect doesn't open, go to:\nSettings > Apps > Health Connect",
        [
          {
            text: "Open Settings",
            onPress: () => Linking.openSettings(),
          },
          { text: "Cancel" },
        ]
      );
    }
  };

  const runPermissionTest = async () => {
    setTesting(true);
    try {
      const availability = await checkHealthConnectAvailability();
      const hasPermission = await testPermission();
      
      setTestResult({ hasPermission, availability });
      
      if (!availability.available) {
        Alert.alert(
          "Health Connect Not Available",
          availability.message,
          [{ text: "OK" }]
        );
      } else if (hasPermission) {
        Alert.alert(
          "Success!",
          "Permission is granted and working correctly!",
          [{ text: "Great!" }]
        );
      } else {
        Alert.alert(
          "Permission Denied",
          "Go to Settings → Apps → TripTune → Permissions and enable 'Physical activity'",
          [
            { text: "Open Settings", onPress: openAppSettings },
            { text: "Cancel" },
          ]
        );
      }
    } catch (error: any) {
      Alert.alert("Test Failed", error.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1 p-6">
        <Text className="text-3xl font-rubik-bold text-gray-900 mb-2">
          Grant Health Connect Permission
        </Text>
        <Text className="text-gray-600 mb-4">
          Follow these steps to give TripTune access to your heart rate data
        </Text>

        {/* Test Permission Button */}
        <TouchableOpacity
          onPress={runPermissionTest}
          disabled={testing}
          className="bg-indigo-500 py-4 px-4 rounded-xl mb-4 flex-row justify-center items-center"
        >
          {testing && <ActivityIndicator color="white" className="mr-2" />}
          <Text className="text-white font-rubik-bold text-lg">
            {testing ? "Testing..." : "Test Permission Status"}
          </Text>
        </TouchableOpacity>

        {/* Test Results */}
        {testResult && (
          <View className={`p-4 rounded-xl mb-6 ${testResult.hasPermission ? 'bg-green-50 border-2 border-green-300' : 'bg-red-50 border-2 border-red-300'}`}>
            <Text className={`font-rubik-bold text-lg mb-2 ${testResult.hasPermission ? 'text-green-900' : 'text-red-900'}`}>
              {testResult.hasPermission ? "Permission Granted!" : "Permission Denied"}
            </Text>
            <Text className={`text-sm ${testResult.hasPermission ? 'text-green-800' : 'text-red-800'}`}>
              Health Connect: {testResult.availability.status}
            </Text>
            <Text className={`text-sm ${testResult.hasPermission ? 'text-green-800' : 'text-red-800'}`}>
              {testResult.availability.message}
            </Text>
            {testResult.hasPermission && (
              <Text className="text-green-800 text-sm mt-2 font-rubik-semibold">
                You're all set! Go to the Fatigue tab to see your heart rate.
              </Text>
            )}
          </View>
        )}

        <Text className="text-gray-600 mb-6">
          Can't find TripTune in Health Connect? Use Android Settings instead:
        </Text>

        {/* RECOMMENDED METHOD: Android Settings */}
        <View className="mb-6 bg-purple-50 p-4 rounded-xl border-4 border-purple-400">
          <View className="flex-row items-center mb-3">
            <View className="bg-purple-500 w-10 h-10 rounded-full items-center justify-center mr-3">
              <Text className="text-white font-rubik-bold text-xl">★</Text>
            </View>
            <Text className="text-xl font-rubik-bold text-gray-900">
              RECOMMENDED: Use Android Settings
            </Text>
          </View>

          <Text className="text-purple-900 mb-3 ml-13 font-rubik-semibold">
            This is the easiest and most reliable method:
          </Text>

          <Text className="text-gray-700 ml-13 mb-1">1. Tap the button below</Text>
          <Text className="text-gray-700 ml-13 mb-1">2. Search for "TripTune"</Text>
          <Text className="text-gray-700 ml-13 mb-3">3. Tap Permissions</Text>
          <Text className="text-gray-700 ml-13 mb-3">4. Enable "Physical activity" or "Body sensors"</Text>

          <TouchableOpacity
            onPress={openAppSettings}
            className="bg-purple-600 py-4 px-4 rounded-lg ml-13"
          >
            <Text className="text-white font-rubik-bold text-center text-lg">
              Open Android Settings
            </Text>
          </TouchableOpacity>
        </View>

        {/* Alternative: Health Connect App */}
        <View className="mb-6 bg-blue-50 p-4 rounded-xl border-2 border-blue-200">
          <View className="flex-row items-center mb-3">
            <View className="bg-blue-500 w-8 h-8 rounded-full items-center justify-center mr-3">
              <Text className="text-white font-rubik-bold text-lg">ALT</Text>
            </View>
            <Text className="text-xl font-rubik-bold text-gray-900">
              Alternative: Health Connect App
            </Text>
          </View>

          <Text className="text-gray-700 mb-3 ml-11">
            Health Connect is an Android system app (NOT Samsung Health). This only works if TripTune appears in the app list.
          </Text>

          <TouchableOpacity
            onPress={openHealthConnectInSettings}
            className="bg-blue-500 py-3 px-4 rounded-lg ml-11"
          >
            <Text className="text-white font-rubik-semibold text-center">
              Try Opening Health Connect
            </Text>
          </TouchableOpacity>
        </View>


        {/* Common Issues */}
        <View className="bg-gray-100 p-4 rounded-xl mb-6">
          <Text className="text-gray-900 font-rubik-bold mb-3 text-lg">
            Common Issues
          </Text>

          <Text className="text-gray-800 font-rubik-semibold mb-1">
            Q: I don't have Health Connect app
          </Text>
          <Text className="text-gray-700 mb-3">
            A: Health Connect should be pre-installed on Android 14+. If not,
            search for "Health Connect" in Google Play Store and install it.
          </Text>

          <Text className="text-gray-800 font-rubik-semibold mb-1">
            Q: TripTune doesn't appear in Health Connect
          </Text>
          <Text className="text-gray-700 mb-3">
            A: Make sure you completely rebuilt the app (not just hot reload).
            Run: npx expo run:android
          </Text>

          <Text className="text-gray-800 font-rubik-semibold mb-1">
            Q: Permission keeps getting denied
          </Text>
          <Text className="text-gray-700 mb-3">
            A: Uninstall TripTune completely, rebuild, reinstall, and grant
            permission when prompted.
          </Text>
        </View>

        {/* Success Message */}
        <View className="bg-green-100 p-4 rounded-xl border-2 border-green-300">
          <Text className="text-green-900 font-rubik-bold mb-2 text-center text-lg">
            After Granting Permission
          </Text>
          <Text className="text-green-800 text-center">
            Go to the Fatigue tab to see your live heart rate data!
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

