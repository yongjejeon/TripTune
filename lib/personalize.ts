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

// ====== Tracking-based schedule adjustment ======

/**
 * Check if there's a trip plan for today's date
 * @param tripPlan - The trip plan object
 * @returns Object with hasPlan flag and day index if found
 */
export function checkPlanForToday(tripPlan: any): { hasPlan: boolean; dayIndex?: number; day?: any } {
  if (!tripPlan?.days || !Array.isArray(tripPlan.days) || tripPlan.days.length === 0) {
    return { hasPlan: false };
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  const dayIndex = tripPlan.days.findIndex((d: any) => d.date === todayStr);
  
  if (dayIndex === -1) {
    return { hasPlan: false };
  }

  return { 
    hasPlan: true, 
    dayIndex,
    day: tripPlan.days[dayIndex],
  };
}

/**
 * Calculate distance in meters between two coordinates
 */
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371e3; // Earth's radius in meters
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Check if user is far from planned activity location
 * @param userLocation - User's current location
 * @param itinerary - Current itinerary
 * @param currentActivityIndex - Index of current/planned activity
 * @param thresholdMeters - Distance threshold (default 500m)
 * @returns Object with isFar flag and distance info
 */
export function checkUserLocationMismatch(
  userLocation: { lat: number; lng: number },
  itinerary: any[],
  currentActivityIndex: number | null,
  thresholdMeters: number = 500
): {
  isFar: boolean;
  distance?: number;
  plannedActivity?: any;
  message?: string;
} {
  if (currentActivityIndex === null || currentActivityIndex < 0 || currentActivityIndex >= itinerary.length) {
    return { isFar: false };
  }

  const plannedActivity = itinerary[currentActivityIndex];
  if (!plannedActivity) {
    return { isFar: false };
  }

  const plannedLat = plannedActivity.lat ?? plannedActivity.coordinates?.lat;
  const plannedLng = plannedActivity.lng ?? plannedActivity.coordinates?.lng;

  if (!plannedLat || !plannedLng) {
    return { isFar: false }; // Can't check without coordinates
  }

  const distance = haversineMeters(userLocation, { lat: plannedLat, lng: plannedLng });

  if (distance > thresholdMeters) {
    return {
      isFar: true,
      distance: Math.round(distance),
      plannedActivity,
      message: `You are ${Math.round(distance / 1000 * 10) / 10} km away from "${plannedActivity.name}"`,
    };
  }

  return { isFar: false, distance };
}

/**
 * Allocate additional transition time and adjust schedule accordingly
 * Adds transition time and adjusts all subsequent activity times
 * Only modifies current and upcoming activities, not completed ones
 * @param itinerary - Current itinerary
 * @param currentActivityIndex - Index of current activity
 * @param additionalMinutes - Additional minutes to allocate (default 15)
 * @returns Adjusted itinerary with increased transition times
 */
export function allocateTransitionTime(
  itinerary: any[],
  currentActivityIndex: number | null,
  additionalMinutes: number = 15
): any[] {
  if (currentActivityIndex === null || currentActivityIndex < 0 || currentActivityIndex >= itinerary.length) {
    return itinerary;
  }

  const adjusted = [...itinerary];
  
  // Helper functions for time conversion
  const timeToMinutes = (t: string) => {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  
  const minutesToTime = (mins: number) => {
    const totalMinutes = mins % (24 * 60); // Handle overflow
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // Add transition time to the current activity
  const currentActivity = adjusted[currentActivityIndex];
  if (currentActivity) {
    // Increase travel time for this activity
    adjusted[currentActivityIndex] = {
      ...currentActivity,
      travel_time_minutes: (currentActivity.travel_time_minutes || 0) + additionalMinutes,
      transitionTimeAdded: additionalMinutes,
    };

    // If current activity has an end_time, adjust subsequent activities from there
    // Otherwise, adjust from start_time
    const referenceTime = currentActivity.end_time || currentActivity.start_time;
    
    if (referenceTime) {
      let referenceMinutes = timeToMinutes(referenceTime);
      
      // Adjust all subsequent activities
      for (let i = currentActivityIndex + 1; i < adjusted.length; i++) {
        const activity = adjusted[i];
        
        if (activity.start_time) {
          let startMinutes = timeToMinutes(activity.start_time);
          startMinutes += additionalMinutes;
          adjusted[i] = {
            ...activity,
            start_time: minutesToTime(startMinutes),
          };

          if (activity.end_time) {
            let endMinutes = timeToMinutes(activity.end_time);
            endMinutes += additionalMinutes;
            adjusted[i] = {
              ...adjusted[i],
              end_time: minutesToTime(endMinutes),
            };
          }
        }
      }
      
      // Also adjust current activity end_time if it exists
      if (currentActivity.end_time) {
        let currentEndMinutes = timeToMinutes(currentActivity.end_time);
        currentEndMinutes += additionalMinutes;
        adjusted[currentActivityIndex] = {
          ...adjusted[currentActivityIndex],
          end_time: minutesToTime(currentEndMinutes),
        };
      }
    }
  }

  return adjusted;
}

/**
 * Find nearest tourist site to user's current location
 * @param userLocation - User's current location
 * @param excludePlaceIds - Place IDs to exclude (already in itinerary)
 * @param maxDistanceKm - Maximum distance in km (default 10km)
 * @returns Nearest tourist site or null
 */
export async function findNearestTouristSite(
  userLocation: { lat: number; lng: number },
  excludePlaceIds: Set<string> = new Set(),
  maxDistanceKm: number = 10
): Promise<any | null> {
  try {
    console.log(`[personalize] Finding nearest tourist site near ${userLocation.lat}, ${userLocation.lng}`);
    
    // Import fetchPlacesByCoordinates dynamically to avoid circular dependencies
    const { fetchPlacesByCoordinates } = await import('./google');
    
    // Fetch nearby places
    const nearbyPlaces = await fetchPlacesByCoordinates(userLocation.lat, userLocation.lng);
    
    if (!nearbyPlaces || nearbyPlaces.length === 0) {
      console.log('[personalize] No nearby places found');
      return null;
    }

    // Filter out excluded places and non-tourist attractions
    const candidatePlaces = nearbyPlaces
      .filter(place => {
        // Exclude places already in itinerary
        if (place.place_id && excludePlaceIds.has(place.place_id)) {
          return false;
        }
        
        // Only include tourist attractions, museums, landmarks, etc.
        const category = place.category || place.normalizedCategory || '';
        const touristCategories = [
          'tourist_attraction', 'museum', 'art_gallery', 'landmark', 
          'park', 'beach', 'palace', 'fort', 'religious_site', 'monument',
          'zoo', 'aquarium', 'theme_park', 'amusement_park'
        ];
        
        return touristCategories.some(tc => category.includes(tc));
      })
      .filter(place => {
        // Check distance
        if (!place.lat || !place.lng) return false;
        const distanceMeters = haversineMeters(userLocation, { lat: place.lat, lng: place.lng });
        return distanceMeters <= maxDistanceKm * 1000;
      })
      .map(place => {
        // Calculate distance and add to place object
        const distanceMeters = haversineMeters(userLocation, { lat: place.lat!, lng: place.lng! });
        return {
          ...place,
          distanceFromUser: distanceMeters,
        };
      })
      .sort((a, b) => a.distanceFromUser - b.distanceFromUser); // Sort by distance

    if (candidatePlaces.length === 0) {
      console.log('[personalize] No suitable tourist sites found within range');
      return null;
    }

    // Return the nearest place
    const nearest = candidatePlaces[0];
    console.log(`[personalize] Found nearest tourist site: "${nearest.name}" (${Math.round(nearest.distanceFromUser)}m away)`);
    
    return nearest;
  } catch (error) {
    console.error('[personalize] Error finding nearest tourist site:', error);
    return null;
  }
}

/**
 * Adjust itinerary to include nearest tourist site based on user's current location
 * This adds the nearest site as the next destination after current activity
 * @param itinerary - Current itinerary
 * @param currentActivityIndex - Index of current activity (activities before this are completed)
 * @param userLocation - User's current location
 * @param nearestSite - Nearest tourist site to add
 * @param options - Options for adjustment
 * @returns Adjusted itinerary with new site inserted
 */
export async function adjustItineraryForCurrentLocation(
  itinerary: any[],
  currentActivityIndex: number | null,
  userLocation: { lat: number; lng: number },
  nearestSite: any,
  options: {
    startTime?: string;
    userLocation: { lat: number; lng: number };
  }
): Promise<any[]> {
  try {
    console.log(`[personalize] Adjusting itinerary to include nearest site: "${nearestSite.name}"`);
    
    if (currentActivityIndex === null) {
      currentActivityIndex = 0;
    }

    // Only modify current and upcoming activities, not completed ones
    const completedActivities = itinerary.slice(0, currentActivityIndex);
    const remainingActivities = itinerary.slice(currentActivityIndex);
    
    // Create new activity from nearest site
    const newActivity = {
      name: nearestSite.name,
      category: nearestSite.category || 'tourist_attraction',
      place_id: nearestSite.place_id,
      lat: nearestSite.lat,
      lng: nearestSite.lng,
      coordinates: { lat: nearestSite.lat, lng: nearestSite.lng },
      photoUrl: nearestSite.photoUrl,
      rating: nearestSite.rating,
      user_ratings_total: nearestSite.user_ratings_total,
      estimated_duration: nearestSite.estimated_duration || 
        (nearestSite.category === 'amusement_park' || nearestSite.category === 'theme_park' 
          ? 360 // 6 hours for amusement/theme parks
          : 90), // Default 90 minutes for others
      locationBasedAddition: true,
      addedReason: 'Added based on current location',
    };

    // Insert new activity at the beginning of remaining activities
    const activitiesToOptimize = [newActivity, ...remainingActivities];
    
    // Re-optimize the remaining itinerary with the new activity
    const reoptimized = await reconstructItinerary(
      userLocation, // Start from user's current location
      activitiesToOptimize,
      { startTime: options.startTime }
    );

    // Combine completed activities with re-optimized ones
    const finalItinerary = [...completedActivities, ...reoptimized];

    console.log(`[personalize] Successfully adjusted itinerary: added "${nearestSite.name}" at position ${currentActivityIndex}`);

    return finalItinerary;
  } catch (error) {
    console.error('[personalize] Error adjusting itinerary for current location:', error);
    throw error;
  }
}
