// screens/Fatigue.tsx
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Fatigue() {
  const [fatigueLevel, setFatigueLevel] = useState<string>("Calculating...");
  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [steps, setSteps] = useState<number>(0);
  const [sleepHours, setSleepHours] = useState<number>(7);

  // Dummy user profile — later we can fetch dynamically
  const userProfile = {
    age: 25,
    weight: 70, // kg
    height: 175, // cm
    sex: "male",
  };

  useEffect(() => {
    // TODO: Replace with actual HR and step data if you connect Apple Health or Google Fit
    const hr = 90; // example heart rate
    const stepCount = 8000; // example steps

    setHeartRate(hr);
    setSteps(stepCount);

    // Very simple fatigue formula — expand later
    if (hr > 110 || stepCount > 10000 || sleepHours < 6) {
      setFatigueLevel("High Fatigue — Consider Rest");
    } else if (hr > 90 || stepCount > 7000) {
      setFatigueLevel("Moderate Fatigue");
    } else {
      setFatigueLevel("Low Fatigue — You're Good to Go");
    }
  }, []);

  return (
    <SafeAreaView className="h-full bg-white">
      <ScrollView contentContainerClassName="p-6">
        <Text className="text-2xl font-rubik-bold mb-6">
          Fatigue Detection
        </Text>

        <View className="mb-6 p-4 rounded-lg bg-gray-100">
          <Text className="text-lg font-rubik-bold">Current Fatigue Level</Text>
          <Text className="text-xl mt-2">{fatigueLevel}</Text>
        </View>

        <View className="p-4 rounded-lg bg-gray-50">
          <Text className="text-md font-rubik-semibold mb-2">Your Stats</Text>
          <Text className="text-sm text-gray-700">Heart Rate: {heartRate} bpm</Text>
          <Text className="text-sm text-gray-700">Steps: {steps}</Text>
          <Text className="text-sm text-gray-700">Sleep: {sleepHours} hrs</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
