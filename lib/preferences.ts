// lib/preferences.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

export type CategoryPref = { weight: number; duration: number };

export type UserPreferences = {
  // biometrics are optional; stored as numbers if present
  age?: number;      // years
  height?: number;   // cm
  weight?: number;   // kg

  // implicit interests & dwell priors
  preferences: Record<string, CategoryPref>;

  // exact POIs the user tapped in the grid (place_ids)
  mustSee: string[];
  
  // places to avoid (place_ids or names)
  avoidPlaces: string[];
};

const KEY = "userPreferences";

const DEFAULTS: UserPreferences = {
  preferences: {},  // empty means "neutral" - google.ts will fall back gracefully
  mustSee: [],
  avoidPlaces: [],
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Load user preferences. Always returns a valid object (never null).
 * - Coerces strings -> numbers for biometrics
 * - Clamps weights to 1..10, durations to 30..360
 * - Backwards compatible with older saves that might lack mustSee/age
 */
export async function getUserPreferences(): Promise<UserPreferences> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULTS;

    const parsed = JSON.parse(raw) ?? {};

    // Normalize category prefs
    const inPrefs = parsed.preferences ?? {};
    const outPrefs: Record<string, CategoryPref> = {};
    for (const cat of Object.keys(inPrefs)) {
      const w = Number(inPrefs[cat]?.weight ?? 5);
      const d = Number(inPrefs[cat]?.duration ?? 90);
      outPrefs[cat] = {
        weight: clamp(Math.round(w), 1, 10),
        duration: clamp(Math.round(d), 30, 360),
      };
    }

    const age    = parsed.age    != null ? Number(parsed.age)    : undefined;
    const height = parsed.height != null ? Number(parsed.height) : undefined;
    const weight = parsed.weight != null ? Number(parsed.weight) : undefined;

    return {
      age: Number.isFinite(age) ? age : undefined,
      height: Number.isFinite(height) ? height : undefined,
      weight: Number.isFinite(weight) ? weight : undefined,
      preferences: outPrefs,
      mustSee: Array.isArray(parsed.mustSee) ? parsed.mustSee : [],
      avoidPlaces: Array.isArray(parsed.avoidPlaces) ? parsed.avoidPlaces : [],
    };
  } catch (e) {
    console.error("prefs:get failed", e);
    return DEFAULTS;
  }
}

/**
 * Overwrite the stored preferences with a fully-formed object.
 */
export async function setUserPreferences(up: UserPreferences): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(up));
}

/**
 * Merge convenience: apply a partial update (e.g., after the user picks 3 places).
 * You can call this instead of writing AsyncStorage directly in Index.tsx.
 */
export async function updateUserPreferences(partial: Partial<UserPreferences>): Promise<UserPreferences> {
  const current = await getUserPreferences();
  const next: UserPreferences = {
    ...current,
    ...partial,
    // merge preferences map if provided
    preferences: partial.preferences
      ? { ...current.preferences, ...partial.preferences }
      : current.preferences,
    // mustSee: replace if provided (your flow usually sends the full set of picks)
    mustSee: Array.isArray(partial.mustSee) ? partial.mustSee : current.mustSee,
    // avoidPlaces: replace if provided
    avoidPlaces: Array.isArray(partial.avoidPlaces) ? partial.avoidPlaces : current.avoidPlaces,
  };
  await setUserPreferences(next);
  return next;
}

/**
 * Add a place to the avoid list (by name or place_id)
 */
export async function addToAvoidList(placeNameOrId: string): Promise<void> {
  const current = await getUserPreferences();
  const avoidPlaces = [...current.avoidPlaces];
  
  // Add if not already in the list
  if (!avoidPlaces.includes(placeNameOrId)) {
    avoidPlaces.push(placeNameOrId);
    await updateUserPreferences({ avoidPlaces });
    console.log(`Added "${placeNameOrId}" to avoid list`);
  }
}

/**
 * Remove a place from the avoid list
 */
export async function removeFromAvoidList(placeNameOrId: string): Promise<void> {
  const current = await getUserPreferences();
  const avoidPlaces = current.avoidPlaces.filter(p => p !== placeNameOrId);
  await updateUserPreferences({ avoidPlaces });
  console.log(`Removed "${placeNameOrId}" from avoid list`);
}

/**
 * Quick helper to add teamLab Phenomena to avoid list (since it's a common unwanted place)
 */
export async function avoidTeamLabPhenomena(): Promise<void> {
  await addToAvoidList("teamLab Phenomena");
}

/**
 * Smart preference inference from user's place selections
 * Analyzes selected places to automatically determine category preferences
 */
export function inferPreferencesFromSelections(selectedPlaces: any[]): Record<string, CategoryPref> {
  console.log("Analyzing user selections to infer preferences...");
  
  if (!selectedPlaces || selectedPlaces.length === 0) {
    console.log("No selections to analyze, using neutral preferences");
    return {};
  }

  // Count categories from selected places
  const categoryCounts: Record<string, number> = {};
  const categoryDurations: Record<string, number[]> = {};
  
  selectedPlaces.forEach(place => {
    const category = place.normalizedCategory || place.category || 'attraction';
    const duration = place.preferredDuration || 90;
    
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    if (!categoryDurations[category]) categoryDurations[category] = [];
    categoryDurations[category].push(duration);
  });

  console.log("Category analysis:", categoryCounts);

  // Calculate preferences based on selection patterns
  const totalSelections = selectedPlaces.length;
  const preferences: Record<string, CategoryPref> = {};

  Object.entries(categoryCounts).forEach(([category, count]) => {
    const selectionRatio = count / totalSelections;
    const avgDuration = categoryDurations[category].reduce((a, b) => a + b, 0) / categoryDurations[category].length;
    
    // Smart weight calculation based on selection frequency
    let weight: number;
    if (selectionRatio >= 0.5) {
      // 50%+ of selections = high preference (8-10)
      weight = Math.min(10, 8 + Math.round(selectionRatio * 2));
    } else if (selectionRatio >= 0.3) {
      // 30-50% of selections = medium-high preference (6-8)
      weight = Math.min(8, 6 + Math.round(selectionRatio * 4));
    } else if (selectionRatio >= 0.2) {
      // 20-30% of selections = medium preference (4-6)
      weight = Math.min(6, 4 + Math.round(selectionRatio * 10));
    } else {
      // <20% of selections = low preference (2-4)
      weight = Math.min(4, 2 + Math.round(selectionRatio * 10));
    }

    preferences[category] = {
      weight: Math.max(1, weight), // Ensure minimum weight of 1
      duration: Math.round(avgDuration)
    };

    console.log(`${category}: ${count}/${totalSelections} selections (${(selectionRatio * 100).toFixed(1)}%) -> weight: ${weight}, duration: ${Math.round(avgDuration)}min`);
  });

  // Add complementary categories based on patterns
  const complementaryCategories = inferComplementaryCategories(categoryCounts);
  complementaryCategories.forEach(({ category, weight, duration }) => {
    if (!preferences[category]) {
      preferences[category] = { weight, duration };
      console.log(`Added complementary category: ${category} (weight: ${weight})`);
    }
  });

  console.log("Inferred preferences:", preferences);
  return preferences;
}

/**
 * Infer complementary categories based on user's selection patterns
 * e.g., if user selects museums, they might also like art galleries
 */
function inferComplementaryCategories(categoryCounts: Record<string, number>): Array<{category: string, weight: number, duration: number}> {
  const complementary: Array<{category: string, weight: number, duration: number}> = [];
  
  // Museum -> Art Gallery, Cultural Sites
  if (categoryCounts.museum) {
    complementary.push({ category: 'art_gallery', weight: Math.max(3, categoryCounts.museum - 1), duration: 90 });
    complementary.push({ category: 'cultural_site', weight: Math.max(2, categoryCounts.museum - 2), duration: 75 });
  }
  
  // Park -> Outdoor Activities, Nature
  if (categoryCounts.park) {
    complementary.push({ category: 'outdoor_activity', weight: Math.max(3, categoryCounts.park - 1), duration: 120 });
    complementary.push({ category: 'nature', weight: Math.max(2, categoryCounts.park - 2), duration: 90 });
  }
  
  // Landmark -> Historical Sites, Architecture
  if (categoryCounts.landmark) {
    complementary.push({ category: 'historical_site', weight: Math.max(3, categoryCounts.landmark - 1), duration: 75 });
    complementary.push({ category: 'architecture', weight: Math.max(2, categoryCounts.landmark - 2), duration: 60 });
  }
  
  // Beach -> Water Activities, Relaxation
  if (categoryCounts.beach) {
    complementary.push({ category: 'water_activity', weight: Math.max(3, categoryCounts.beach - 1), duration: 150 });
    complementary.push({ category: 'relaxation', weight: Math.max(2, categoryCounts.beach - 2), duration: 120 });
  }
  
  return complementary;
}
