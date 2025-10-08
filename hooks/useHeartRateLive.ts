// hooks/useHeartRateLive.ts
import { ensureHCReady, readLatestBpmFast } from "@/lib/health";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

type HRState = {
  bpm: number | null;
  at?: string;
  authorized: boolean | null;
};

export function useHeartRateLive(pollMs = 1000) {
  const [state, setState] = useState<HRState>({
    bpm: null,
    at: undefined,
    authorized: null,
  });

  // correct timer type in RN
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // init + permission
  useEffect(() => {
    (async () => {
      try {
        await ensureHCReady(); // initialize + request read:HeartRate if needed
        setState((s) => ({ ...s, authorized: true }));
      } catch (e) {
        setState((s) => ({ ...s, authorized: false }));
      }
    })();
  }, []);

  const startPolling = useCallback(() => {
    if (timerRef.current) return;
    const tick = async () => {
      try {
        const { bpm, at } = await readLatestBpmFast(120); // last 2 min
        // only update if new timestamp or value changed
        setState((prev) => {
          if (at && prev.at && new Date(at).getTime() <= new Date(prev.at).getTime()) {
            return prev; // no newer data
          }
          if (bpm === prev.bpm && at === prev.at) return prev;
          return { ...prev, bpm, at };
        });
      } catch {
        // ignore single tick failures
      }
    };
    tick(); // run once immediately
    timerRef.current = setInterval(tick, pollMs);
  }, [pollMs]);

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  // Poll only while the screen using this hook is focused
  useFocusEffect(
    useCallback(() => {
      startPolling();
      return () => stopPolling();
    }, [startPolling, stopPolling])
  );

  return {
    bpm: state.bpm,
    at: state.at,
    authorized: state.authorized,
    startPolling,
    stopPolling,
  };
}
