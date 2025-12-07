// app/(root)/(tabs)/health_test.tsx - Comprehensive Health Connect Testing Screen
import {
  ensureHCReady,
  findRecentHeartRate,
  openHCSettings,
  readHeartRateSeries,
  readLatestBpm,
  readLatestBpmFast,
  readLatestChunk,
  runHealthConnectDiagnostics,
  triggerHeartRateMeasurement,
} from "@/lib/health";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useRef, useState } from "react";
import {
  Alert,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function HealthTest() {
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [liveHR, setLiveHR] = useState<{ bpm: number | null; at?: string }>({
    bpm: null,
  });
  const [polling, setPolling] = useState(false);
  const [series, setSeries] = useState<{ bpm: number; at: string }[]>([]);
  const [chunk, setChunk] = useState<{ bpm: number; at: string }[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${timestamp}] ${message}`, ...prev].slice(0, 50));
    console.log(`[HealthTest] ${message}`);
  };

  // Run diagnostics
  const handleRunDiagnostics = async () => {
    setIsRunning(true);
    addLog("Starting comprehensive diagnostics...");
    try {
      const result = await runHealthConnectDiagnostics();
      setDiagnostics(result);
      addLog(`Diagnostics complete: ${result.errors.length} errors`);
      
      if (result.errors.length > 0) {
        Alert.alert(
          "Diagnostics Results",
          `Found ${result.errors.length} issue(s):\n\n${result.errors.join("\n")}`,
          [
            { text: "Open Settings", onPress: () => openHCSettings() },
            { text: "OK" },
          ]
        );
      } else {
        Alert.alert(
          "✅ All Tests Passed!",
          `Heart Rate: ${result.latestData.bpm} BPM\nSource: ${result.latestData.source}`
        );
      }
    } catch (error: any) {
      addLog(`Diagnostics failed: ${error.message}`);
      Alert.alert("Error", error.message);
    } finally {
      setIsRunning(false);
    }
  };

  // Live polling
  const startPolling = useCallback(() => {
    if (timerRef.current) return;
    
    setPolling(true);
    addLog("Started live polling (every 2 seconds)");
    
    const poll = async () => {
      try {
        const result = await readLatestBpmFast(10);
        setLiveHR(result);
        if (result.bpm) {
          const age = result.at
            ? Math.round((Date.now() - new Date(result.at).getTime()) / 1000)
            : null;
          addLog(`Live: ${result.bpm} BPM (${age}s ago)`);
        }
      } catch (error: any) {
        addLog(`Poll error: ${error.message}`);
      }
    };

    poll(); // Immediate
    timerRef.current = setInterval(poll, 2000);
  }, []);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPolling(false);
    addLog("Stopped live polling");
  }, []);

  // Fetch series
  const handleFetchSeries = async () => {
    addLog("Fetching all samples (last 60 min)...");
    try {
      const result = await readHeartRateSeries(60);
      setSeries(result);
      addLog(`Fetched ${result.length} samples`);
      
      if (result.length === 0) {
        Alert.alert(
          "No Data",
          "No heart rate samples found in the last 60 minutes. Make sure your Galaxy Watch is connected and has measured heart rate recently."
        );
      }
    } catch (error: any) {
      addLog(`Fetch series failed: ${error.message}`);
      Alert.alert("Error", error.message);
    }
  };

  // Fetch latest chunk
  const handleFetchChunk = async () => {
    addLog("Fetching latest batch...");
    try {
      const result = await readLatestChunk(180);
      setChunk(result);
      addLog(`Fetched ${result.length} samples from latest batch`);
      
      if (result.length === 0) {
        Alert.alert(
          "No Batch Data",
          "No recent batch found. Samsung Health syncs data in batches. Try measuring your heart rate on your watch."
        );
      }
    } catch (error: any) {
      addLog(`Fetch chunk failed: ${error.message}`);
      Alert.alert("Error", error.message);
    }
  };

  // Test different time windows
  const handleTestWindows = async () => {
    addLog("Testing different time windows...");
    try {
      const windows = [5, 10, 30, 60, 180];
      for (const minutes of windows) {
        const result = await readLatestBpm(minutes);
        addLog(
          `${minutes}min window: ${result.bpm ? `${result.bpm} BPM` : "No data"}`
        );
      }
      Alert.alert("Window Test Complete", "Check logs for results");
    } catch (error: any) {
      addLog(`Window test failed: ${error.message}`);
    }
  };

  // Initialize on focus
  useFocusEffect(
    useCallback(() => {
      addLog("Screen focused, initializing...");
      ensureHCReady()
        .then(() => addLog("Health Connect ready"))
        .catch((e) => addLog(`Init failed: ${e.message}`));
      
      return () => {
        stopPolling();
      };
    }, [stopPolling])
  );

  const getStatusColor = (value: boolean | undefined) => {
    if (value === true) return "#10B981"; // green
    if (value === false) return "#EF4444"; // red
    return "#6B7280"; // gray
  };

  const getStatusIcon = (value: boolean | undefined) => {
    if (value === true) return "✅";
    if (value === false) return "❌";
    return "⏳";
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1">
        <View className="p-6">
          {/* Header */}
          <View className="mb-6">
            <Text className="text-3xl font-rubik-bold text-gray-900 mb-2">
              Health Connect Test
            </Text>
            <Text className="text-gray-600">
              Comprehensive testing and debugging for Galaxy Watch integration
            </Text>
          </View>

          {/* Live Heart Rate Display */}
          <View className="bg-gradient-to-r from-red-50 to-pink-50 p-6 rounded-2xl mb-6 border border-red-100">
            <Text className="text-center text-gray-600 mb-2">Live Heart Rate</Text>
            <Text className="text-center text-6xl font-rubik-bold text-red-500 mb-2">
              {liveHR.bpm ?? "-"}
            </Text>
            <Text className="text-center text-gray-600 mb-4">BPM</Text>
            {liveHR.at && (
              <Text className="text-center text-sm text-gray-500">
                Last: {new Date(liveHR.at).toLocaleTimeString()} (
                {Math.round((Date.now() - new Date(liveHR.at).getTime()) / 1000)}s
                ago)
              </Text>
            )}
            <View className="flex-row justify-center mt-4">
              <TouchableOpacity
                onPress={polling ? stopPolling : startPolling}
                className={`${
                  polling ? "bg-red-500" : "bg-green-500"
                } px-6 py-2 rounded-full`}
              >
                <Text className="text-white font-rubik-semibold">
                  {polling ? "Stop Polling" : "Start Polling"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Diagnostics Results */}
          {diagnostics && (
            <View className="bg-gray-50 p-4 rounded-xl mb-6">
              <Text className="text-lg font-rubik-bold mb-3">
                Diagnostics Results
              </Text>
              
              <View className="space-y-2">
                <View className="flex-row justify-between items-center py-2">
                  <Text className="text-gray-700">Initialized:</Text>
                  <Text
                    className="font-rubik-semibold"
                    style={{ color: getStatusColor(diagnostics.initialized) }}
                  >
                    {getStatusIcon(diagnostics.initialized)}{" "}
                    {diagnostics.initialized ? "Yes" : "No"}
                  </Text>
                </View>

                <View className="flex-row justify-between items-center py-2">
                  <Text className="text-gray-700">Permission Granted:</Text>
                  <Text
                    className="font-rubik-semibold"
                    style={{ color: getStatusColor(diagnostics.permissionGranted) }}
                  >
                    {getStatusIcon(diagnostics.permissionGranted)}{" "}
                    {diagnostics.permissionGranted ? "Yes" : "No"}
                  </Text>
                </View>

                <View className="flex-row justify-between items-center py-2">
                  <Text className="text-gray-700">Data Available:</Text>
                  <Text
                    className="font-rubik-semibold"
                    style={{ color: getStatusColor(diagnostics.dataAvailable) }}
                  >
                    {getStatusIcon(diagnostics.dataAvailable)}{" "}
                    {diagnostics.dataAvailable ? "Yes" : "No"}
                  </Text>
                </View>

                {diagnostics.latestData.bpm && (
                  <View className="flex-row justify-between items-center py-2">
                    <Text className="text-gray-700">Latest HR:</Text>
                    <Text className="font-rubik-semibold text-red-500">
                      {diagnostics.latestData.bpm} BPM
                    </Text>
                  </View>
                )}

                {diagnostics.errors.length > 0 && (
                  <View className="mt-2 p-3 bg-red-50 rounded-lg">
                    <Text className="text-red-800 font-rubik-semibold mb-1">
                      Errors:
                    </Text>
                    {diagnostics.errors.map((error: string, i: number) => (
                      <Text key={i} className="text-red-700 text-sm">
                        • {error}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Action Buttons */}
          <View className="space-y-3 mb-6">
            <TouchableOpacity
              onPress={handleRunDiagnostics}
              disabled={isRunning}
              className="bg-blue-500 py-4 rounded-xl flex-row justify-center items-center"
            >
              {isRunning && <ActivityIndicator color="white" className="mr-2" />}
              <Text className="text-white font-rubik-bold text-lg">
                {isRunning ? "Running Diagnostics..." : "Run Full Diagnostics"}
              </Text>
            </TouchableOpacity>

            <View className="flex-row space-x-3">
              <TouchableOpacity
                onPress={handleFetchSeries}
                className="flex-1 bg-purple-500 py-3 rounded-xl"
              >
                <Text className="text-white font-rubik-semibold text-center">
                  Fetch 60min
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleFetchChunk}
                className="flex-1 bg-indigo-500 py-3 rounded-xl"
              >
                <Text className="text-white font-rubik-semibold text-center">
                  Latest Batch
                </Text>
              </TouchableOpacity>
            </View>

            <View className="flex-row space-x-3">
              <TouchableOpacity
                onPress={handleTestWindows}
                className="flex-1 bg-green-500 py-3 rounded-xl"
              >
                <Text className="text-white font-rubik-semibold text-center">
                  Test Windows
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => openHCSettings()}
                className="flex-1 bg-gray-500 py-3 rounded-xl"
              >
                <Text className="text-white font-rubik-semibold text-center">
                  HC Settings
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={async () => {
                await triggerHeartRateMeasurement();
                Alert.alert(
                  "Manual Measurement",
                  "Please measure your heart rate on your Galaxy Watch. Data should sync within 1-2 minutes."
                );
              }}
              className="bg-orange-500 py-3 rounded-xl"
            >
              <Text className="text-white font-rubik-semibold text-center">
                📱 Trigger Watch Measurement
              </Text>
            </TouchableOpacity>
          </View>

          {/* Data Display */}
          {series.length > 0 && (
            <View className="mb-6">
              <Text className="text-lg font-rubik-bold mb-2">
                All Samples (Last 60min): {series.length}
              </Text>
              <ScrollView className="bg-gray-50 p-3 rounded-xl max-h-48">
                {series.slice(0, 20).map((s, i) => (
                  <Text key={i} className="text-gray-700 text-sm mb-1">
                    {new Date(s.at).toLocaleTimeString()} → {s.bpm} BPM
                  </Text>
                ))}
                {series.length > 20 && (
                  <Text className="text-gray-500 text-sm italic">
                    ... and {series.length - 20} more
                  </Text>
                )}
              </ScrollView>
            </View>
          )}

          {chunk.length > 0 && (
            <View className="mb-6">
              <Text className="text-lg font-rubik-bold mb-2">
                Latest Batch: {chunk.length} samples
              </Text>
              <ScrollView className="bg-gray-50 p-3 rounded-xl max-h-48">
                {chunk.map((s, i) => (
                  <Text key={i} className="text-gray-700 text-sm mb-1">
                    {new Date(s.at).toLocaleTimeString()} → {s.bpm} BPM
                  </Text>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Logs */}
          <View className="mb-6">
            <Text className="text-lg font-rubik-bold mb-2">Activity Log</Text>
            <ScrollView className="bg-black p-3 rounded-xl max-h-64">
              {logs.length === 0 ? (
                <Text className="text-gray-400 text-sm">No logs yet...</Text>
              ) : (
                logs.map((log, i) => (
                  <Text key={i} className="text-green-400 text-xs mb-1 font-mono">
                    {log}
                  </Text>
                ))
              )}
            </ScrollView>
          </View>

          {/* Help Section */}
          <View className="bg-blue-50 p-4 rounded-xl">
            <Text className="text-blue-900 font-rubik-bold mb-2">
              💡 Troubleshooting Tips
            </Text>
            <Text className="text-blue-800 text-sm mb-1">
              1. Make sure your Galaxy Watch is connected via Bluetooth
            </Text>
            <Text className="text-blue-800 text-sm mb-1">
              2. Enable continuous heart rate monitoring in Samsung Health
            </Text>
            <Text className="text-blue-800 text-sm mb-1">
              3. Grant all permissions in Health Connect settings
            </Text>
            <Text className="text-blue-800 text-sm mb-1">
              4. Manually measure heart rate on watch to test sync
            </Text>
            <Text className="text-blue-800 text-sm">
              5. Data syncs in batches every 1-5 minutes
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

