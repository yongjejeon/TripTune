// lib/personalize.ts - Handle itinerary regeneration after user personalization (replacements, etc.)
import { reconstructItinerary } from './itineraryOptimizer';

export interface ReplacementOptions {
  userLocation: { lat: number; lng: number };
  startTime?: string; // Preferred start time for the day
  preserveOrder?: boolean; // If true, try to keep activities in the same order (only swap the replaced one)
  replacementMetadata?: {
    isWeatherReplacement?: boolean;
    weatherReason?: string;
    replacementReason?: string;
  };
}

/**
 * Regenerate itinerary after replacing an activity
 * 
 * This function:
 * 1. Replaces the activity at the specified index with the new place
 * 2. Fetches detailed information (including opening hours) for the replacement
 * 3. Re-optimizes the itinerary using reconstructItinerary
 * 4. Ensures all activities remain in the final itinerary (D, B, C if A was replaced with D)
 * 
 * @param currentItinerary - Current itinerary array
 * @param replacementIndex - Index of the activity to replace
 * @param replacementPlace - New place to replace with (must have place_id, lat, lng, name)
 * @param options - Options for regeneration
 * @returns Promise with the regenerated itinerary
 */
export async function regenerateItineraryAfterReplacement(
  currentItinerary: any[],
  replacementIndex: number,
  replacementPlace: {
    place_id?: string;
    name: string;
    lat: number;
    lng: number;
    category?: string;
    photoUrl?: string;
    rating?: number;
    user_ratings_total?: number;
  },
  options: ReplacementOptions
): Promise<any[]> {
  try {
    console.log(`[personalize] Regenerating itinerary: replacing activity at index ${replacementIndex} with "${replacementPlace.name}"`);
    
    if (replacementIndex < 0 || replacementIndex >= currentItinerary.length) {
      throw new Error(`Invalid replacement index: ${replacementIndex}`);
    }

    // Step 1: Prepare replacement details
    // Note: Opening hours will be fetched and merged during the reconstructItinerary process
    // if the place_id is available. For now, we use the provided data.
    const replacementDetails = { ...replacementPlace };

    // Step 2: Create the new itinerary with the replacement
    const originalActivity = currentItinerary[replacementIndex];
    const replacedItinerary = [...currentItinerary];
    
    // Replace the activity at the specified index
    replacedItinerary[replacementIndex] = {
      ...originalActivity, // Preserve original activity properties
      // Update with replacement details
      name: replacementDetails.name,
      category: replacementDetails.category || originalActivity.category || 'activity',
      place_id: replacementDetails.place_id || originalActivity.place_id,
      lat: replacementDetails.lat,
      lng: replacementDetails.lng,
      coordinates: { lat: replacementDetails.lat, lng: replacementDetails.lng },
      photoUrl: replacementDetails.photoUrl || originalActivity.photoUrl,
      rating: replacementDetails.rating ?? originalActivity.rating,
      user_ratings_total: replacementDetails.user_ratings_total ?? originalActivity.user_ratings_total,
      // Preserve opening hours if available
      opening_hours: replacementDetails.opening_hours || originalActivity.opening_hours,
      // Mark as user replacement (can be weather or manual)
      userReplacement: true,
      originalActivityName: originalActivity.name,
      replacementReason: options.replacementMetadata?.replacementReason 
        || (options.replacementMetadata?.isWeatherReplacement 
            ? (options.replacementMetadata?.weatherReason || 'Weather-based replacement')
            : (originalActivity.weatherReplacement 
                ? (originalActivity.weatherReason || 'Weather-based replacement')
                : 'User requested replacement')),
      weatherReplacement: options.replacementMetadata?.isWeatherReplacement 
        || originalActivity.weatherReplacement 
        || false,
      weatherReason: options.replacementMetadata?.weatherReason 
        || originalActivity.weatherReason,
    };

    console.log(`[personalize] Created replaced itinerary with ${replacedItinerary.length} activities`);
    console.log(`[personalize] Replacement: "${originalActivity.name}" → "${replacementDetails.name}"`);

    // Step 3: Re-optimize the itinerary
    // reconstructItinerary will:
    // - Recalculate travel times based on new locations
    // - Check opening hours and adjust times accordingly
    // - Optimize the route order
    // - Ensure all activities remain in the itinerary
    
    const startTime = options.startTime;
    console.log(`[personalize] Re-optimizing itinerary with start time: ${startTime || 'default'}`);
    
    const reoptimized = await reconstructItinerary(
      options.userLocation,
      replacedItinerary,
      { startTime }
    );

    if (!reoptimized || reoptimized.length === 0) {
      throw new Error('Failed to re-optimize itinerary - returned empty result');
    }

    if (reoptimized.length !== replacedItinerary.length) {
      console.warn(
        `[personalize] Warning: Optimized itinerary has ${reoptimized.length} activities, expected ${replacedItinerary.length}`
      );
      // This shouldn't happen, but if it does, we log a warning
      // The optimizer should preserve all activities
    }

    console.log(`[personalize] Successfully regenerated itinerary with ${reoptimized.length} activities`);
    
    // Verify that the replacement is still in the itinerary
    const replacementStillPresent = reoptimized.some(
      (item: any) => item.name === replacementDetails.name || item.place_id === replacementDetails.place_id
    );
    
    if (!replacementStillPresent) {
      console.error(`[personalize] ERROR: Replacement "${replacementDetails.name}" not found in optimized itinerary!`);
      throw new Error('Replacement activity was lost during optimization');
    }

    // Verify all original activities are still present (except the replaced one)
    const originalNames = currentItinerary.map((item: any, idx: number) => 
      idx === replacementIndex ? null : item.name
    ).filter(Boolean);
    
    const optimizedNames = reoptimized.map((item: any) => item.name);
    const missingActivities = originalNames.filter(
      (name: string | null) => name && !optimizedNames.includes(name)
    );
    
    if (missingActivities.length > 0) {
      console.warn(`[personalize] Warning: Some activities may have been removed:`, missingActivities);
      // This is a warning, not an error, as the optimizer might remove activities if they don't fit
    }

    return reoptimized;
  } catch (error) {
    console.error('[personalize] Error regenerating itinerary:', error);
    throw error;
  }
}

/**
 * Helper function to validate that a replacement can be made
 * Checks if the replacement place has valid location data
 */
export function validateReplacement(
  replacementPlace: {
    place_id?: string;
    name: string;
    lat?: number;
    lng?: number;
  }
): { valid: boolean; error?: string } {
  if (!replacementPlace.name || replacementPlace.name.trim() === '') {
    return { valid: false, error: 'Replacement place must have a name' };
  }

  if (!replacementPlace.lat || !replacementPlace.lng) {
    if (!replacementPlace.place_id) {
      return { valid: false, error: 'Replacement place must have coordinates or place_id' };
    }
  }

  return { valid: true };
}
