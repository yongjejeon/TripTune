// import AsyncStorage from "@react-native-async-storage/async-storage";

// export type UserPreferences = {
//   height: string;
//   weight: string;
//   preferences: Record<
//     string,
//     {
//       weight: number;
//       duration: number;
//     }
//   >;
// };

// export const getUserPreferences = async (): Promise<UserPreferences | null> => {
//   try {
//     const stored = await AsyncStorage.getItem("userPreferences");
//     return stored ? JSON.parse(stored) : null;
//   } catch (err) {
//     console.error("Error loading user preferences:", err);
//     return null;
//   }
// };
import AsyncStorage from "@react-native-async-storage/async-storage";

export type UserPreferences = {
  height: string;
  weight: string;
  preferences: Record<
    string,
    {
      weight: number;   // how important this category is
      duration: number; // preferred time to spend (in minutes)
    }
  >;
};

export const getUserPreferences = async (): Promise<UserPreferences | null> => {
  try {
    const stored = await AsyncStorage.getItem("userPreferences");
    return stored ? JSON.parse(stored) : null;
  } catch (err) {
    console.error("Error loading user preferences:", err);
    return null;
  }
};

// 🔹 Apply preferences to filter and score Google Places results
export const applyPreferences = (places: any[], prefs: UserPreferences) => {
  if (!prefs) return places;

  return places
    .map((place) => {
      // Base score starts at 0
      let score = 0;
      const category = place.category?.toLowerCase() || "other";

      // Preference weighting
      if (prefs.preferences[category]) {
        score += prefs.preferences[category].weight * 5; // scale weight
      }

      // Bonus for high-rated places
      if (place.rating >= 4.5) score += 3;
      else if (place.rating >= 4.0) score += 2;

      return {
        ...place,
        score,
        preferred_duration:
          prefs.preferences[category]?.duration || 60, // fallback 1hr
      };
    })
    .filter((p) => p.score > 0) // remove low-value items
    .sort((a, b) => b.score - a.score);
};
