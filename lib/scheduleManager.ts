// lib/scheduleManager.ts - Real-time schedule monitoring and adjustment
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchPlacesByCoordinates } from './google';

export interface ScheduleStatus {
  currentActivityIndex: number;
  isOnTime: boolean;
  isBehindSchedule: boolean;
  delayMinutes: number;
  nextActivityStart: string;
  currentActivityEnd: string;
  estimatedArrival: string;
}

export interface ScheduleAdjustment {
  type: 'extend_current' | 'skip_next' | 'replace_next' | 'reschedule_remaining';
  description: string;
  impact: string;
  newItinerary: any[];
  timeSaved: number; // minutes
}

export interface LocationContext {
  lat: number;
  lng: number;
  timestamp: string;
  accuracy: number;
  isAtActivity: boolean;
  activityId?: string;
}

/**
 * Calculate if user is behind schedule based on current time and planned activities
 */
export function calculateScheduleStatus(
  itinerary: any[],
  currentActivityIndex: number,
  currentTime: Date = new Date()
): ScheduleStatus {
  if (!itinerary || itinerary.length === 0 || currentActivityIndex < 0) {
    return {
      currentActivityIndex: 0,
      isOnTime: true,
      isBehindSchedule: false,
      delayMinutes: 0,
      nextActivityStart: '',
      currentActivityEnd: '',
      estimatedArrival: '',
    };
  }

  const currentActivity = itinerary[currentActivityIndex];
  const nextActivity = itinerary[currentActivityIndex + 1];
  
  if (!currentActivity) {
    return {
      currentActivityIndex,
      isOnTime: true,
      isBehindSchedule: false,
      delayMinutes: 0,
      nextActivityStart: '',
      currentActivityEnd: currentActivity?.end_time || '',
      estimatedArrival: '',
    };
  }

  // Parse current activity end time
  const currentEndTime = parseTimeToDate(currentActivity.end_time, currentTime);
  const nextStartTime = nextActivity ? parseTimeToDate(nextActivity.start_time, currentTime) : null;
  
  // Calculate delay
  const delayMinutes = Math.max(0, Math.floor((currentTime.getTime() - currentEndTime.getTime()) / (1000 * 60)));
  
  const isBehindSchedule = delayMinutes > 10; // 10 minute tolerance for automatic prompts
  const isOnTime = !isBehindSchedule;

  return {
    currentActivityIndex,
    isOnTime,
    isBehindSchedule,
    delayMinutes,
    nextActivityStart: nextActivity?.start_time || '',
    currentActivityEnd: currentActivity.end_time,
    estimatedArrival: nextStartTime ? formatDateToTime(nextStartTime) : '',
  };
}

/**
 * Generate intelligent schedule adjustments based on delay and remaining activities
 */
export async function generateScheduleAdjustments(
  itinerary: any[],
  scheduleStatus: ScheduleStatus,
  userLocation: { lat: number; lng: number }
): Promise<ScheduleAdjustment[]> {
  const adjustments: ScheduleAdjustment[] = [];
  const { delayMinutes, currentActivityIndex } = scheduleStatus;
  
  if (delayMinutes <= 10) {
    return adjustments; // No adjustments needed for small delays
  }

  const remainingActivities = itinerary.slice(currentActivityIndex + 1);
  if (remainingActivities.length === 0) {
    return adjustments; // No remaining activities to adjust
  }

  // Adjustment 1: Extend current activity time
  if (currentActivityIndex < itinerary.length - 1) {
    const currentActivity = itinerary[currentActivityIndex];
    const nextActivity = itinerary[currentActivityIndex + 1];
    
    const newItinerary = [...itinerary];
    const newEndTime = addMinutesToTime(currentActivity.end_time, delayMinutes);
    const newStartTime = addMinutesToTime(nextActivity.start_time, delayMinutes);
    
    newItinerary[currentActivityIndex] = {
      ...currentActivity,
      end_time: newEndTime,
      estimated_duration: currentActivity.estimated_duration + delayMinutes,
    };
    
    newItinerary[currentActivityIndex + 1] = {
      ...nextActivity,
      start_time: newStartTime,
    };

    adjustments.push({
      type: 'extend_current',
      description: `Extend current activity by ${delayMinutes} minutes`,
      impact: `All remaining activities will be delayed by ${delayMinutes} minutes`,
      newItinerary,
      timeSaved: 0,
    });
  }

  // Adjustment 2: Skip next activity
  if (remainingActivities.length > 1) {
    const newItinerary = itinerary.filter((_, index) => index !== currentActivityIndex + 1);
    
    adjustments.push({
      type: 'skip_next',
      description: `Skip "${remainingActivities[0].name}"`,
      impact: `Save ${remainingActivities[0].estimated_duration} minutes, continue with remaining activities`,
      newItinerary,
      timeSaved: remainingActivities[0].estimated_duration,
    });
  }

  // Adjustment 3: Replace next activity with shorter alternative
  if (remainingActivities.length > 0) {
    const nextActivity = remainingActivities[0];
    const shorterAlternatives = await findShorterAlternatives(nextActivity, userLocation);
    
    if (shorterAlternatives.length > 0) {
      const bestAlternative = shorterAlternatives[0];
      const timeSaved = nextActivity.estimated_duration - bestAlternative.estimated_duration;
      
      const newItinerary = [...itinerary];
      newItinerary[currentActivityIndex + 1] = {
        ...bestAlternative,
        start_time: nextActivity.start_time,
        end_time: addMinutesToTime(nextActivity.start_time, bestAlternative.estimated_duration),
        replacementReason: `Replaced due to schedule delay (saves ${timeSaved} minutes)`,
        originalActivity: nextActivity.name,
      };

      adjustments.push({
        type: 'replace_next',
        description: `Replace "${nextActivity.name}" with "${bestAlternative.name}"`,
        impact: `Save ${timeSaved} minutes, shorter activity duration`,
        newItinerary,
        timeSaved,
      });
    }
  }

  // Adjustment 4: Reschedule remaining activities (if delay is significant)
  if (delayMinutes > 30 && remainingActivities.length > 1) {
    const newItinerary = [...itinerary];
    let currentTime = new Date();
    currentTime.setMinutes(currentTime.getMinutes() + delayMinutes); // Start from current time + delay
    
    // Reschedule all remaining activities
    for (let i = currentActivityIndex + 1; i < newItinerary.length; i++) {
      const activity = newItinerary[i];
      const startTime = formatDateToTime(currentTime);
      const endTime = addMinutesToTime(startTime, activity.estimated_duration);
      
      newItinerary[i] = {
        ...activity,
        start_time: startTime,
        end_time: endTime,
        rescheduled: true,
      };
      
      currentTime.setMinutes(currentTime.getMinutes() + activity.estimated_duration + 15); // Add 15min buffer
    }

    adjustments.push({
      type: 'reschedule_remaining',
      description: `Reschedule all remaining activities from current time`,
      impact: `Realistic timing based on current progress, may skip some activities`,
      newItinerary,
      timeSaved: delayMinutes,
    });
  }

  return adjustments;
}

/**
 * Find shorter alternatives for an activity
 */
async function findShorterAlternatives(
  originalActivity: any,
  userLocation: { lat: number; lng: number }
): Promise<any[]> {
  try {
    const nearbyPlaces = await fetchPlacesByCoordinates(userLocation.lat, userLocation.lng);
    
    // Filter for shorter activities of similar type
    const alternatives = nearbyPlaces.filter(place => {
      const isShorter = (place.preferredDuration || 90) < (originalActivity.estimated_duration || 90);
      const isSimilarType = place.normalizedCategory === originalActivity.category ||
                           place.category === originalActivity.category;
      const isGoodRating = (place.rating || 0) >= 3.5;
      
      return isShorter && isSimilarType && isGoodRating;
    });

    // Sort by duration (shortest first) and rating
    return alternatives.sort((a, b) => {
      const durationA = a.preferredDuration || 90;
      const durationB = b.preferredDuration || 90;
      const ratingA = a.rating || 0;
      const ratingB = b.rating || 0;
      
      // Prioritize shorter duration, then higher rating
      if (durationA !== durationB) return durationA - durationB;
      return ratingB - ratingA;
    }).slice(0, 3); // Return top 3 alternatives
    
  } catch (error) {
    console.error('❌ Failed to find shorter alternatives:', error);
    return [];
  }
}

/**
 * Check if user is at a specific activity location
 */
export function isUserAtActivity(
  userLocation: LocationContext,
  activity: any,
  thresholdMeters: number = 100
): boolean {
  if (!activity.lat || !activity.lng) return false;
  
  const distance = calculateDistance(
    userLocation.lat,
    userLocation.lng,
    activity.lat,
    activity.lng
  );
  
  return distance <= thresholdMeters;
}

/**
 * Calculate distance between two points in meters
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

/**
 * Parse time string to Date object
 */
function parseTimeToDate(timeString: string, baseDate: Date): Date {
  const [hours, minutes] = timeString.split(':').map(Number);
  const date = new Date(baseDate);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/**
 * Format Date to time string
 */
function formatDateToTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Add minutes to time string
 */
function addMinutesToTime(timeString: string, minutes: number): string {
  const [hours, mins] = timeString.split(':').map(Number);
  const totalMinutes = hours * 60 + mins + minutes;
  const newHours = Math.floor(totalMinutes / 60) % 24;
  const newMins = totalMinutes % 60;
  return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
}

/**
 * Save schedule adjustment for later reference
 */
export async function saveScheduleAdjustment(adjustment: ScheduleAdjustment): Promise<void> {
  try {
    await AsyncStorage.setItem('lastScheduleAdjustment', JSON.stringify({
      ...adjustment,
      timestamp: new Date().toISOString(),
    }));
  } catch (error) {
    console.error('❌ Failed to save schedule adjustment:', error);
  }
}

/**
 * Get last schedule adjustment
 */
export async function getLastScheduleAdjustment(): Promise<ScheduleAdjustment | null> {
  try {
    const saved = await AsyncStorage.getItem('lastScheduleAdjustment');
    return saved ? JSON.parse(saved) : null;
  } catch (error) {
    console.error('❌ Failed to get last schedule adjustment:', error);
    return null;
  }
}
