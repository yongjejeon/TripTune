// screens/Fatigue.tsx
import { ensureHCReady, findRecentHeartRate, triggerHeartRateMeasurement } from "@/lib/health";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useRef, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const POLL_MS = 15000; // 15s is realistic for HC sync

export default function Fatigue() {
  const [bpm, setBpm] = useState<number | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [dataSource, setDataSource] = useState<string>("none");
  const [isLoading, setIsLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tick = useCallback(async () => {
    try {
      setIsLoading(true);
      await ensureHCReady();
      const result = await findRecentHeartRate();
      setBpm(result.bpm);
      setLast(result.at ?? null);
      setDataSource(result.source);
      setUpdatedAt(new Date().toLocaleTimeString());
    } catch (e) {
      console.error("HR poll error:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      tick(); // immediate
      timerRef.current = setInterval(tick, POLL_MS);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
      };
    }, [tick])
  );

  const getDataSourceColor = (source: string) => {
    switch (source) {
      case "recent": return "#10B981"; // green
      case "hourly": return "#F59E0B"; // yellow
      case "extended": return "#EF4444"; // red
      case "chunk": return "#8B5CF6"; // purple
      default: return "#6B7280"; // gray
    }
  };

  const getDataSourceText = (source: string) => {
    switch (source) {
      case "recent": return "Recent (10min)";
      case "hourly": return "Hourly (1hr)";
      case "extended": return "Extended (3hr)";
      case "chunk": return "Latest Batch";
      default: return "No Data";
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center px-6">
        <View className="items-center mb-8">
          <Text className="text-2xl font-rubik-bold mb-2">Heart Rate Monitor</Text>
          <Text className="text-gray-600 text-center">
            Real-time heart rate detection for fatigue analysis
          </Text>
        </View>

        <View className="bg-gray-50 p-6 rounded-xl mb-6 w-full max-w-sm">
          <View className="items-center mb-4">
            <Text className="text-4xl font-rubik-bold text-gray-900 mb-2">
              {isLoading ? "..." : (bpm != null ? `${bpm}` : "—")}
            </Text>
            <Text className="text-lg text-gray-600">BPM</Text>
          </View>

          <View className="space-y-2">
            <View className="flex-row justify-between">
              <Text className="text-gray-600">Data Source:</Text>
              <Text 
                className="font-rubik-semibold"
                style={{ color: getDataSourceColor(dataSource) }}
              >
                {getDataSourceText(dataSource)}
              </Text>
            </View>

            <View className="flex-row justify-between">
              <Text className="text-gray-600">Last Sample:</Text>
              <Text className="text-gray-900">
                {last ? new Date(last).toLocaleTimeString() : "—"}
              </Text>
            </View>

            <View className="flex-row justify-between">
              <Text className="text-gray-600">Updated:</Text>
              <Text className="text-gray-900">{updatedAt || "—"}</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          onPress={async () => {
            try {
              await triggerHeartRateMeasurement();
              Alert.alert(
                "Manual Measurement",
                "Please measure your heart rate on your Galaxy Watch. The data should appear within a few minutes.",
                [{ text: "OK" }]
              );
            } catch (error) {
              Alert.alert("Error", "Failed to trigger measurement");
            }
          }}
          className="bg-blue-500 py-3 px-6 rounded-lg mb-4"
        >
          <Text className="text-white font-rubik-semibold text-center">
            Trigger Manual Measurement
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={tick}
          disabled={isLoading}
          className="bg-gray-200 py-3 px-6 rounded-lg"
        >
          <Text className="text-gray-800 font-rubik-semibold text-center">
            {isLoading ? "Refreshing..." : "Refresh Now"}
          </Text>
        </TouchableOpacity>

        <View className="mt-6 p-4 bg-blue-50 rounded-lg">
          <Text className="text-sm text-blue-800 text-center">
            💡 Tip: Enable continuous heart rate monitoring in Samsung Health settings for automatic updates
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
