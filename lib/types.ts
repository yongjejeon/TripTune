// lib/fatigue/types.ts

export type Sex = "male" | "female" | "unspecified";

export type UserProfile = {
  age: number;
  heightCm: number;
  weightKg: number;
  sex?: Sex;
};

export type SensorWindow = {
  /** window length in minutes */
  minutes: number;
  /** optional: live steps for the window */
  steps?: number;
  /** optional: distance traveled in this window (km) */
  distanceKm?: number;
  /** optional: floors/elevation gain (meters) */
  elevationGainM?: number;
  /** optional: average heart rate during window (bpm) */
  hr?: number;
};

export type ContextWindow = {
  /** env */
  tempC?: number;
  heatIndexC?: number;
  rain?: "none" | "light" | "moderate" | "heavy";
  uvIndex?: number;

  /** what the user is doing */
  transitType?: "walk" | "bus" | "car";
  poiType?:
    | "museum" | "art_gallery" | "religious_sites" | "landmark"
    | "park" | "beach" | "aquarium" | "zoo" | "amusement_park"
    | "sports" | "market" | "souk" | "cafe" | "tourist_attraction"
    | "attraction" | "indoor" | "outdoor";

  /** minutes late vs. plan (positive means behind schedule) */
  timePressureMin?: number;
};

export type TraceRow = {
  tISO: string;
  kcal: number;           // raw estimated kcal for the window
  kcalAdj: number;        // after modifiers
  source: "hr" | "distance" | "met" | "unknown";
  modifiers: Record<string, number>; // e.g., { heat:+0.2, rain:+0.1 }
  scoreAfter: number;     // 0..100
};

export type FatigueState = {
  score0to100: number;
  kcalToday: number;
  lastUpdateISO: string;
  source: "hr" | "met" | "steps" | "distance" | "unknown";
  trace: TraceRow[];      // most recent first (cap length)
};
