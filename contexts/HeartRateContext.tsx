// contexts/HeartRateContext.tsx - Global heart rate monitoring
import { ensureHCReady, readLatestBpmFast } from "@/lib/health";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus } from "react-native";

interface HeartRateData {
  bpm: number | null;
  timestamp: string | undefined;
  lastUpdated: Date | null;
}

interface HeartRateContextType {
  heartRate: HeartRateData;
  isMonitoring: boolean;
  error: string | null;
  startMonitoring: () => void;
  stopMonitoring: () => void;
  refreshNow: () => Promise<void>;
}

const HeartRateContext = createContext<HeartRateContextType | undefined>(
  undefined
);

const POLL_INTERVAL_MS = 30 * 1000; // 30 seconds (aggressive polling to catch Health Connect updates)

export function HeartRateProvider({ children }: { children: React.ReactNode }) {
  const [heartRate, setHeartRate] = useState<HeartRateData>({
    bpm: null,
    timestamp: undefined,
    lastUpdated: null,
  });
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appState = useRef(AppState.currentState);

  // Fetch heart rate data
  const fetchHeartRate = useCallback(async (triggerSync: boolean = false) => {
    try {
      // Optionally trigger Samsung Health sync before fetching
      if (triggerSync) {
        const { triggerSamsungHealthSync } = await import("@/lib/health");
        await triggerSamsungHealthSync();
        // Wait a moment for sync to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log("[HeartRateContext] Fetching heart rate...");
      const result = await readLatestBpmFast(); // Use default 180-minute window to handle sync delays
      
      setHeartRate({
        bpm: result.bpm,
        timestamp: result.at,
        lastUpdated: new Date(),
      });

      if (result.bpm !== null) {
        setError(null);
        console.log(`[HeartRateContext] Heart rate updated: ${result.bpm} BPM`);
      } else {
        console.log("[HeartRateContext] No heart rate data available");
      }
    } catch (err: any) {
      console.error("[HeartRateContext] Error fetching heart rate:", err);
      setError(err.message || "Failed to fetch heart rate");
    }
  }, []);

  // Start monitoring
  const startMonitoring = useCallback(async () => {
    if (isMonitoring) {
      console.log("[HeartRateContext] Already monitoring");
      return;
    }

    console.log("[HeartRateContext] Starting heart rate monitoring...");

    try {
      // Initialize Health Connect and request permissions
      await ensureHCReady();
      console.log("[HeartRateContext] Health Connect ready");

      // Fetch immediately
      await fetchHeartRate();

      // Set up polling every 5 minutes
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      timerRef.current = setInterval(() => {
        fetchHeartRate();
      }, POLL_INTERVAL_MS);

      setIsMonitoring(true);
      console.log(
        `[HeartRateContext] Monitoring started (polling every ${POLL_INTERVAL_MS / 1000}s)`
      );
    } catch (err: any) {
      console.error("[HeartRateContext] Failed to start monitoring:", err);
      setError(err.message || "Failed to start monitoring");
      setIsMonitoring(false);
    }
  }, [isMonitoring, fetchHeartRate]);

  // Stop monitoring
  const stopMonitoring = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsMonitoring(false);
    console.log("[HeartRateContext] Monitoring stopped");
  }, []);

  // Refresh immediately
  const refreshNow = useCallback(async () => {
    console.log("[HeartRateContext] Manual refresh triggered");
    await fetchHeartRate();
  }, [fetchHeartRate]);

  // Force a fresh read with cache busting
  const forceFreshRead = useCallback(async () => {
    console.log("[HeartRateContext] Force fresh read with cache busting...");
    try {
      const { forceFreshRead: cacheBustRead } = await import("@/lib/health");
      const result = await cacheBustRead();
      
      setHeartRate({
        bpm: result.bpm,
        timestamp: result.at,
        lastUpdated: new Date(),
      });

      if (result.bpm !== null) {
        setError(null);
        console.log(`[HeartRateContext] Cache bust successful: ${result.bpm} BPM`);
      }
    } catch (err: any) {
      console.error("[HeartRateContext] Cache bust failed:", err);
      setError(err.message || "Failed to refresh");
    }
  }, []);

  // Handle app state changes (pause when backgrounded)
  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (nextAppState: AppStateStatus) => {
        if (
          appState.current.match(/inactive|background/) &&
          nextAppState === "active"
        ) {
          // App came to foreground
          console.log("[HeartRateContext] App foregrounded, refreshing...");
          if (isMonitoring) {
            fetchHeartRate();
          }
        }

        appState.current = nextAppState;
      }
    );

    return () => {
      subscription.remove();
    };
  }, [isMonitoring, fetchHeartRate]);

  // Auto-start monitoring when provider mounts
  useEffect(() => {
    console.log("[HeartRateContext] Provider mounted, auto-starting...");
    startMonitoring();

    return () => {
      stopMonitoring();
    };
  }, []); // Only run once on mount

  return (
    <HeartRateContext.Provider
      value={{
        heartRate,
        isMonitoring,
        error,
        startMonitoring,
        stopMonitoring,
        refreshNow,
      }}
    >
      {children}
    </HeartRateContext.Provider>
  );
}

// Hook to use heart rate context
export function useHeartRate() {
  const context = useContext(HeartRateContext);
  if (context === undefined) {
    throw new Error("useHeartRate must be used within a HeartRateProvider");
  }
  return context;
}

