// app/TestConnection.tsx
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
    ensureHCReady,
    openHCSettings,
    readHeartRateSeries,
    readLatestBpm,
    readLatestChunk,
} from "@/lib/health";

export default function TestConnection() {
  const router = useRouter();

  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [hr, setHr] = useState<number | null>(null);
  const [at, setAt] = useState<string | undefined>(undefined);
  const [polling, setPolling] = useState(true);
  const [series, setSeries] = useState<{ bpm: number; at: string }[]>([]);
  const [chunk, setChunk] = useState<{ bpm: number; at: string }[]>([]);

  // Correct timer type in RN
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 1) Initialize HC + request permission on mount
  useEffect(() => {
    (async () => {
      try {
        console.log("[UI] ensureHCReady()");
        await ensureHCReady();
        setAuthorized(true);
      } catch (e: any) {
        console.log("[UI] ensureHCReady() failed:", e?.message ?? e);
        setAuthorized(false);
        Alert.alert(
          "Health Connect required",
          String(e?.message ?? e),
          [
            { text: "Open Health Connect", onPress: () => openHCSettings() },
            { text: "OK" },
          ]
        );
      }
    })();
  }, []);

  // 2) Optional: “live” polling for the latest *single* sample (UI feedback only)
  useEffect(() => {
    if (authorized !== true || !polling) return;

    const poll = async () => {
      try {
        const { bpm, at } = await readLatestBpm(60); // look back 60 minutes
        setHr(bpm);
        setAt(at);
        const age = at ? Math.round((Date.now() - new Date(at).getTime()) / 1000) : null;
        console.log(`[UI] live poll → bpm=${bpm ?? "∅"} at=${at ?? "∅"} ageSec=${age ?? "∅"}`);
      } catch (e: any) {
        console.log("HR poll error:", e?.message ?? e);
      }
    };

    // kick once, then interval
    poll();
    pollRef.current = setInterval(poll, 1000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [authorized, polling]);

  const handleOpenHC = async () => {
    try {
      await openHCSettings();
    } catch (e: any) {
      Alert.alert("Unable to open Health Connect", String(e?.message ?? e));
    }
  };

  const handleContinue = () => {
    router.replace("/(root)/(tabs)");
  };

  // 3) Fetch *all* samples in last 60 min (to see dense data)
  const handleFetchSeries = async () => {
    console.log("[UI] Fetching series (60 min) …");
    const s = await readHeartRateSeries(60);
    setSeries(s);
    if (s.length) {
      console.log(
        `[UI] Series count=${s.length} newest=${s[0].at} oldest=${s.at(-1)?.at}`
      );
    } else {
      console.log("[UI] Series is empty");
    }
  };

  // 4) Fetch the most recent *chunk* (batch) of samples
  const handleFetchLatestChunk = async () => {
    console.log("[UI] Fetching latest chunk …");
    const c = await readLatestChunk(180); // last 3h window for safety
    setChunk(c);
    if (c.length) {
      console.log(
        `[UI] Latest chunk count=${c.length} range=${c[0].at} → ${c.at(-1)?.at}`
      );
    } else {
      console.log("[UI] Latest chunk is empty");
    }
  };

  const renderList = (items: { bpm: number; at: string }[], title: string) => (
    <View style={{ marginTop: 16 }}>
      <Text style={{ color: "white", fontSize: 16, marginBottom: 8 }}>{title}</Text>
      <ScrollView style={{ maxHeight: 220, borderWidth: 1, borderColor: "#333", borderRadius: 12, padding: 12 }}>
        {items.length === 0 ? (
          <Text style={{ color: "#aaa" }}>No data</Text>
        ) : (
          items.map((s, i) => {
            const ageSec = Math.round((Date.now() - new Date(s.at).getTime()) / 1000);
            return (
              <Text key={i} style={{ color: "white", marginBottom: 6 }}>
                {new Date(s.at).toLocaleTimeString()} → {s.bpm} bpm  ({ageSec}s ago)
              </Text>
            );
          })
        )}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-black">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-white text-2xl font-rubik-semibold mb-4 text-center">
          Test your connection
        </Text>

        <Text className="text-white text-base text-center opacity-80 mb-6">
          We read your heart rate via Health Connect. Samsung Health sends continuous data in batches;
          use the buttons below to fetch all samples or the latest batch.
        </Text>

        {/* Live latest (single value) */}
        <Text className="text-white text-5xl font-rubik-extrabold mb-2">
          {hr != null ? `${hr} bpm` : "—"}
        </Text>
        <Text className="text-white opacity-70 mb-6">
          {at
            ? (() => {
                const age = Math.round((Date.now() - new Date(at).getTime()) / 1000);
                return `${new Date(at).toLocaleTimeString()} (${age}s ago)`;
              })()
            : authorized === null
            ? "Initializing…"
            : authorized
            ? "Waiting for recent heart rate…"
            : "Not authorized"}
        </Text>

        {/* Controls */}
        <View className="w-full max-w-[360px]">
          <TouchableOpacity
            onPress={() => setPolling((p) => !p)}
            className="bg-primary-300 rounded-full px-6 py-3 mb-3"
          >
            <Text className="text-white text-lg font-rubik-medium text-center">
              {polling ? "Stop Live Polling" : "Start Live Polling"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleFetchSeries}
            className="bg-white rounded-full px-6 py-3 mb-3"
          >
            <Text className="text-black text-lg font-rubik-medium text-center">
              Fetch last 60 min (all samples)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleFetchLatestChunk}
            className="bg-white rounded-full px-6 py-3 mb-6"
          >
            <Text className="text-black text-lg font-rubik-medium text-center">
              Fetch latest batch (chunk)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleOpenHC}
            className="border border-white rounded-full px-6 py-3 mb-3"
          >
            <Text className="text-white text-lg font-rubik-medium text-center">
              Open Health Connect settings
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleContinue}
            className="border border-white rounded-full px-6 py-3"
          >
            <Text className="text-white text-lg font-rubik-medium text-center">
              Continue
            </Text>
          </TouchableOpacity>
        </View>

        {/* Lists */}
        <View style={{ width: "100%", maxWidth: 360, marginTop: 12 }}>
          {renderList(series, "All samples (last 60 min)")}
          {renderList(chunk, "Latest batch (newest lastModified)")}
        </View>
      </View>
    </SafeAreaView>
  );
}
