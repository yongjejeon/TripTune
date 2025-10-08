// lib/localCache.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const SEED_PREFIX = "seed:";
const DETAILS_PREFIX = "details:";
const CACHE_VERSION = 1;

export type CachedSeed = {
  v: number;            // schema version
  ts: number;           // saved at (ms)
  geokey: string;       // cell id
  items: any[];         // compact POIs (no hours)
};

export type CachedDetails = {
  v: number;
  ts: number;
  place_id: string;
  details: any;         // raw Place Details result (hours, address, etc.)
};

// ~5–6km cell near equator (adjust if you want)
export function geoKeyFromLatLng(lat: number, lng: number, cell = 0.05) {
  const rl = (x: number) => Math.round(x / cell) * cell;
  return `${rl(lat).toFixed(2)},${rl(lng).toFixed(2)}@${cell.toFixed(2)}`;
}

export function isFresh(ts: number, ttlHours: number) {
  const ttlMs = ttlHours * 3600 * 1000;
  return Date.now() - ts < ttlMs;
}

// -------- seed cache (list by area) --------
export async function getSeed(geokey: string): Promise<CachedSeed | null> {
  const raw = await AsyncStorage.getItem(SEED_PREFIX + geokey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === CACHE_VERSION) return parsed as CachedSeed;
    return null;
  } catch {
    return null;
  }
}

export async function setSeed(geokey: string, items: any[]): Promise<void> {
  const payload: CachedSeed = { v: CACHE_VERSION, ts: Date.now(), geokey, items };
  await AsyncStorage.setItem(SEED_PREFIX + geokey, JSON.stringify(payload));
}

// -------- details cache (by place) --------
export async function getDetails(placeId: string): Promise<CachedDetails | null> {
  const raw = await AsyncStorage.getItem(DETAILS_PREFIX + placeId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === CACHE_VERSION) return parsed as CachedDetails;
    return null;
  } catch {
    return null;
  }
}

export async function setDetails(placeId: string, details: any): Promise<void> {
  const payload: CachedDetails = { v: CACHE_VERSION, ts: Date.now(), place_id: placeId, details };
  await AsyncStorage.setItem(DETAILS_PREFIX + placeId, JSON.stringify(payload));
}
