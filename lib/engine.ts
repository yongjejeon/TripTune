// lib/fatigue/engine.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  ContextWindow,
  FatigueState,
  SensorWindow,
  TraceRow,
  UserProfile,
} from "./types";
import { getWeatherContext } from "./weatherAware";

/** ---- Tunables (start simple, tune later) ---- */
const K_PER_KCAL_TO_SCORE = 0.06;  // how fast fatigue rises per kcal in the window
const RECOVERY_PER_MIN_SITTING = 0.15; // score pts recovered per seated minute (bus/car)
const SMOOTHING = 0.3;             // EWMA: new = 0.3*raw + 0.7*prev
const TRACE_CAP = 50;              // keep last N rows in memory

/** crude MET table for fallback when we have neither HR nor distance */
const METS: Record<string, number> = {
  museum: 2.5,
  art_gallery: 2.5,
  religious_sites: 2.5,
  landmark: 3.0,
  park: 3.5,
  beach: 3.5,
  aquarium: 2.3,
  zoo: 3.0,
  amusement_park: 4.0,
  sports: 4.5,
  market: 3.0,
  souk: 3.0,
  cafe: 1.8,
  tourist_attraction: 3.0,
  attraction: 3.0,
  indoor: 2.3,
  outdoor: 3.2,
};

/** Resting energy (Harris-Benedict) mainly for reference/baseline if needed */
export function estimateREEkcalDay(profile: UserProfile): number {
  const { age, heightCm, weightKg, sex = "unspecified" } = profile;
  if (sex === "female") {
    return 655.1 + 9.563 * weightKg + 1.850 * heightCm - 4.676 * age;
  }
  // default to male formula if unspecified
  return 66.5 + 13.75 * weightKg + 5.003 * heightCm - 6.775 * age;
}

/**
 * HR -> Energy (Keytel). Returns kcal for the window.
 * Male:  EE (J/min) = -55.0969 + 0.6309 * HR + 0.1988 * weight(kg) + 0.2017 * age
 * Female:EE (J/min) = -20.4022 + 0.4472 * HR - 0.1263 * weight(kg) + 0.074  * age
 * Convert J/min -> kcal/min (/ 4184).
 */
function keytelKcalPerMin(hr: number, profile: UserProfile): number {
  const { age, weightKg, sex = "unspecified" } = profile;
  const isFemale = sex === "female";
  const jPerMin = isFemale
    ? -20.4022 + 0.4472 * hr - 0.1263 * weightKg + 0.074 * age
    : -55.0969 + 0.6309 * hr + 0.1988 * weightKg + 0.2017 * age;
  return Math.max(0, jPerMin) / 4184;
}

/** Estimate energy in kcal for the window */
export function estimateEnergyKcal(
  profile: UserProfile,
  sensors: SensorWindow,
  context: ContextWindow
): { kcal: number; source: "hr" | "distance" | "met" | "unknown" } {
  const mins = Math.max(0, sensors.minutes || 0.0001);

  // 1) HR present -> best
  if (sensors.hr && profile.age && profile.weightKg) {
    const kcalPerMin = keytelKcalPerMin(sensors.hr, profile);
    return { kcal: kcalPerMin * mins, source: "hr" };
  }

  // 2) Distance present -> walking/running cost
  if ((sensors.distanceKm ?? 0) > 0) {
    const dist = sensors.distanceKm as number;
    const elev = sensors.elevationGainM ?? 0;
    // walk: ~1.0 kcal/kg/km; add +0.01 kcal/kg per meter climbed
    const base = profile.weightKg * dist;
    const hill = profile.weightKg * (elev * 0.01);
    return { kcal: Math.max(0, base + hill), source: "distance" };
  }

  // 3) MET fallback
  const met =
    METS[context.poiType ?? "attraction"] ??
    (context.transitType === "walk" ? 3.0 : 1.5);
  const kcal = (met * 3.5 * profile.weightKg * mins) / 200;
  return { kcal, source: "met" };
}

/** Apply contextual modifiers -> return adjusted kcal and a modifiers map */
export function applyModifiers(
  kcal: number,
  sensors: SensorWindow,
  context: ContextWindow
): { kcalAdj: number; mods: Record<string, number> } {
  const mods: Record<string, number> = {};

  // Heat (prefer heatIndex if present)
  const hi = context.heatIndexC ?? context.tempC;
  if (typeof hi === "number") {
    if (hi >= 38) mods.heat = +0.35;
    else if (hi >= 32) mods.heat = +0.2;
  }

  // Rain
  if (context.rain && context.rain !== "none") {
    mods.rain = { light: +0.05, moderate: +0.1, heavy: +0.15 }[
      context.rain
    ] as number;
  }

  // Time pressure (behind schedule)
  if ((context.timePressureMin ?? 0) >= 20) {
    mods.time = +0.15;
  }

  // Seated transit -> recovery later in update, but you can dampen cost slightly
  if (context.transitType === "bus" || context.transitType === "car") {
    mods.seated = -0.15;
  }

  // Clamp the total modifier between -40% and +60%
  const total =
    Object.values(mods).reduce((a, b) => a + b, 0);
  const clamped = Math.max(-0.4, Math.min(0.6, total));
  const kcalAdj = kcal * (1 + clamped);

  return { kcalAdj, mods: { ...mods, _total: clamped } };
}

/** Update fatigue state with the adjusted kcal + recovery */
export function updateFatigue(
  prev: FatigueState | null,
  profile: UserProfile,
  sensors: SensorWindow,
  context: ContextWindow,
  kcalAdj: number,
  source: FatigueState["source"]
): FatigueState {
  const nowISO = new Date().toISOString();
  const prevScore = prev?.score0to100 ?? 12; // start low
  const prevKcal = prev?.kcalToday ?? 0;

  // Fatigue increment from effort
  let rawDelta = kcalAdj * K_PER_KCAL_TO_SCORE;

  // Recovery during seated transit (bus/car)
  if ((context.transitType === "bus" || context.transitType === "car") && sensors.minutes) {
    rawDelta -= RECOVERY_PER_MIN_SITTING * sensors.minutes;
  }

  // Smooth EWMA + clamp
  const rawNext = Math.max(0, prevScore + rawDelta);
  const score = Math.max(0, Math.min(100, SMOOTHING * rawNext + (1 - SMOOTHING) * prevScore));

  const traceRow: TraceRow = {
    tISO: nowISO,
    kcal: Math.max(0, (kcalAdj / (1 + 0)) /* original shown via mods in caller */),
    kcalAdj,
    source: source === "distance" ? "distance" : source === "hr" ? "hr" : "met",
    modifiers: {}, // caller fills if needed
    scoreAfter: score,
  };

  const next: FatigueState = {
    score0to100: score,
    kcalToday: prevKcal + Math.max(0, kcalAdj),
    lastUpdateISO: nowISO,
    source,
    trace: [traceRow, ...(prev?.trace ?? [])].slice(0, TRACE_CAP),
  };

  return next;
}

/** Convenience: load/save fatigue state */
export async function loadFatigueState(): Promise<FatigueState | null> {
  try {
    const raw = await AsyncStorage.getItem("fatigueState");
    return raw ? (JSON.parse(raw) as FatigueState) : null;
  } catch {
    return null;
  }
}

export async function saveFatigueState(state: FatigueState) {
  try {
    await AsyncStorage.setItem("fatigueState", JSON.stringify(state));
  } catch {}
}

/**
 * Enhance context window with current weather data
 */
export async function enhanceContextWithWeather(context: ContextWindow): Promise<ContextWindow> {
  try {
    const weather = await getWeatherContext();
    if (!weather) return context;

    return {
      ...context,
      tempC: weather.temperature,
      rain: weather.condition === 'Rain' || weather.condition === 'Thunderstorm' ? 'moderate' : 
            weather.condition === 'Drizzle' ? 'light' : 'none',
    };
  } catch (error) {
    console.error('Failed to enhance context with weather:', error);
    return context;
  }
}
