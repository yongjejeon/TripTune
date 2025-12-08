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
  
  if (!currentActivity || !currentActivity.end_time) {
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

  console.log(`-----------------------------------------------------------------------------------------------------------------------------------`);
  console.log(`[Schedule Status] ===== CALCULATING SCHEDULE STATUS =====`);
  console.log(`-----------------------------------------------------------------------------------------------------------------------------------`);
  console.log(`[Schedule Status] Current time: ${currentTime.toISOString()} (${formatDateToTime(currentTime)})`);
  console.log(`[Schedule Status] Current activity index: ${currentActivityIndex}`);
  console.log(`[Schedule Status] Current activity: ${currentActivity.name}`);
  console.log(`[Schedule Status] Current activity end_time string: "${currentActivity.end_time}"`);
  console.log(`[Schedule Status] Current activity travel_time_minutes: ${currentActivity.travel_time_minutes || 'not set'}`);
  console.log(`[Schedule Status] Next activity: ${nextActivity?.name || 'none'}`);
  console.log(`[Schedule Status] Next activity start_time string: "${nextActivity?.start_time || 'none'}"`);
  console.log(`[Schedule Status] Itinerary length: ${itinerary.length}`);
  console.log(`[Schedule Status] First 3 activities in itinerary:`);
  itinerary.slice(0, 3).forEach((act, idx) => {
    console.log(`[Schedule Status]   [${idx}] ${act.name} - start: "${act.start_time || 'N/A'}", end: "${act.end_time || 'N/A'}"`);
  });
  
  // Parse current activity end time (with safety check)
  const currentEndTime = parseTimeToDate(currentActivity.end_time, currentTime);
  let nextStartTime = nextActivity?.start_time ? parseTimeToDate(nextActivity.start_time, currentTime) : null;
  
  console.log(`[Schedule Status] Parsed currentEndTime: ${currentEndTime.toISOString()} (${formatDateToTime(currentEndTime)})`);
  if (nextStartTime) {
    console.log(`[Schedule Status] Parsed nextStartTime (initial): ${nextStartTime.toISOString()} (${formatDateToTime(nextStartTime)})`);
  }
  
  // CRITICAL FIX: Ensure nextStartTime is correctly parsed for same-day future times
  // The issue: when nextStartTime is later today (e.g., 13:59 when current is 12:05),
  // parseTimeToDate might incorrectly place it in the past due to date/time parsing issues
  if (nextStartTime && nextActivity.start_time) {
    const currentTimeStr = formatDateToTime(currentTime);
    const nextTimeStr = nextActivity.start_time;
    
    // Parse times as minutes since midnight for easy comparison
    const [currentH, currentM] = currentTimeStr.split(':').map(Number);
    const [nextH, nextM] = nextTimeStr.split(':').map(Number);
    const currentMinutes = currentH * 60 + currentM;
    const nextMinutes = nextH * 60 + nextM;
    
    const nextStartTimeDiff = nextStartTime.getTime() - currentTime.getTime();
    const nextStartTimeMinutesDiff = Math.round(nextStartTimeDiff / (1000 * 60));
    
    console.log(`[Schedule Status] Time string comparison: current="${currentTimeStr}" (${currentMinutes} min) vs next="${nextTimeStr}" (${nextMinutes} min)`);
    console.log(`[Schedule Status] Parsed time difference: ${nextStartTimeMinutesDiff} minutes`);
    
    // If the next time string is numerically later than current time string, it MUST be later today
    // (unless we've passed midnight, which we handle separately)
    if (nextMinutes > currentMinutes) {
      // Next time is later today - ensure nextStartTime reflects this
      const correctNextStartTime = new Date(currentTime);
      correctNextStartTime.setHours(nextH, nextM, 0, 0);
      
      // If somehow the parsed time is wrong, fix it
      if (correctNextStartTime.getTime() <= currentTime.getTime()) {
        // This shouldn't happen if nextMinutes > currentMinutes, but handle it anyway
        correctNextStartTime.setDate(correctNextStartTime.getDate() + 1);
      }
      
      // Only update if the parsed time was wrong
      if (Math.abs(correctNextStartTime.getTime() - nextStartTime.getTime()) > 60000) { // More than 1 minute difference
        nextStartTime = correctNextStartTime;
        console.log(`[Schedule Status] FIXED: nextStartTime was incorrectly parsed. Corrected to: ${nextStartTime.toISOString()} (${formatDateToTime(nextStartTime)})`);
      }
    } else if (nextStartTimeDiff < 0) {
      // Next time string is earlier, but we're checking if it's meant for tomorrow
      const hoursDiff = Math.abs(nextStartTimeDiff) / (1000 * 60 * 60);
      if (hoursDiff > 12) {
        // More than 12 hours in past - likely meant for tomorrow
        nextStartTime.setDate(nextStartTime.getDate() + 1);
        console.log(`[Schedule Status] Next start time was ${Math.round(hoursDiff)} hours in past, adjusted to next day: ${nextStartTime.toISOString()} (${formatDateToTime(nextStartTime)})`);
      }
    }
    
    const finalDiff = nextStartTime.getTime() - currentTime.getTime();
    const finalDiffMinutes = Math.round(finalDiff / (1000 * 60));
    console.log(`[Schedule Status] Final nextStartTime: ${nextStartTime.toISOString()} (${formatDateToTime(nextStartTime)})`);
    console.log(`[Schedule Status] Final time difference: ${finalDiffMinutes} minutes (${finalDiff > 0 ? 'IN FUTURE ✓' : 'IN PAST ✗'})`);
  }
  
  // Calculate delay for current activity
  const delayForCurrentActivity = Math.max(0, Math.floor((currentTime.getTime() - currentEndTime.getTime()) / (1000 * 60)));
  console.log(`[Schedule Status] Delay for current activity: ${delayForCurrentActivity} minutes`);
  
  // If there's a next activity, calculate delay considering transition time
  // CRITICAL: Just because the user finished the current activity late doesn't mean they're behind schedule
  // They're only behind schedule if they can't reach the NEXT activity on time
  let delayMinutes = 0;
  let isBehindSchedule = false;
  
  if (nextActivity && nextActivity.start_time && nextStartTime) {
    // Get transition time to next activity (from current activity's travel_time_minutes if available)
    // If not available, calculate from time difference between activities
    const transitionTimeMinutes = currentActivity.travel_time_minutes || 
      (nextStartTime ? Math.max(0, Math.floor((nextStartTime.getTime() - currentEndTime.getTime()) / (1000 * 60))) : 15);
    
    console.log(`[Schedule Status] Transition time to next activity: ${transitionTimeMinutes} minutes`);
    
    // Calculate when user needs to leave current activity to reach next on time
    const requiredDepartureTime = new Date(nextStartTime.getTime() - transitionTimeMinutes * 60 * 1000);
    console.log(`[Schedule Status] Required departure time: ${requiredDepartureTime.toISOString()} (${formatDateToTime(requiredDepartureTime)})`);
    console.log(`[Schedule Status] Current time: ${currentTime.toISOString()} (${formatDateToTime(currentTime)})`);
    console.log(`[Schedule Status] Next start time: ${nextStartTime.toISOString()} (${formatDateToTime(nextStartTime)})`);
    
    // Calculate time available to reach next activity
    const timeAvailableMinutes = Math.floor((nextStartTime.getTime() - currentTime.getTime()) / (1000 * 60));
    console.log(`[Schedule Status] Time available to reach next activity: ${timeAvailableMinutes} minutes`);
    console.log(`[Schedule Status] Time needed (transition): ${transitionTimeMinutes} minutes`);
    
    // If current time is past when they need to leave, they're behind schedule
    if (currentTime > requiredDepartureTime) {
      // Calculate delay: how late they are for reaching the next activity
      const delayForNextActivity = Math.floor((currentTime.getTime() - requiredDepartureTime.getTime()) / (1000 * 60));
      delayMinutes = Math.max(0, delayForNextActivity);
      isBehindSchedule = delayMinutes > 10; // 10 minute tolerance
      
      console.log(`[Schedule Status] User is behind schedule for next activity. Delay: ${delayForNextActivity} minutes`);
      console.log(`[Schedule Status] Final delay: ${delayMinutes} minutes, isBehindSchedule: ${isBehindSchedule}`);
    } else {
      // User has enough time to reach next activity - they're NOT behind schedule
      // Even if they finished the current activity late, they can still make it to the next one
      delayMinutes = 0;
      isBehindSchedule = false;
      console.log(`[Schedule Status] User is ON TIME - has ${timeAvailableMinutes} minutes to reach next activity (needs ${transitionTimeMinutes} minutes)`);
    }
  } else {
    // No next activity - only check if current activity is late
    delayMinutes = delayForCurrentActivity;
    isBehindSchedule = delayMinutes > 10;
    console.log(`[Schedule Status] No next activity - using current activity delay: ${delayMinutes} minutes`);
  }
  
  console.log(`[Schedule Status] ===== SCHEDULE STATUS CALCULATION COMPLETE =====`);
  console.log(`[Schedule Status] FINAL RESULT:`);
  console.log(`[Schedule Status]   isBehindSchedule: ${isBehindSchedule}`);
  console.log(`[Schedule Status]   delayMinutes: ${delayMinutes}`);
  console.log(`[Schedule Status]   isOnTime: ${!isBehindSchedule}`);
  console.log(`-----------------------------------------------------------------------------------------------------------------------------------`);
  
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

  // Adjustment 1: Extend current activity time and push all subsequent activities
  if (currentActivityIndex < itinerary.length - 1) {
    const currentActivity = itinerary[currentActivityIndex];
    const newItinerary = [...itinerary];
    
    console.log("-----------------------------------------------------------------------------------------------------------------------------------");
    console.log("[Schedule Adjustment] ===== GENERATING EXTEND_CURRENT ADJUSTMENT =====");
    console.log("-----------------------------------------------------------------------------------------------------------------------------------");
    console.log("[Schedule Adjustment] Extending current activity:", currentActivity.name);
    console.log("[Schedule Adjustment] Current end_time:", currentActivity.end_time);
    console.log("[Schedule Adjustment] Delay minutes:", delayMinutes);
    console.log("[Schedule Adjustment] Current activity index:", currentActivityIndex);
    console.log("[Schedule Adjustment] Total activities in itinerary:", itinerary.length);
    
    // Update current activity end time
    const newEndTime = addMinutesToTime(currentActivity.end_time, delayMinutes);
    console.log("[Schedule Adjustment] New end_time:", newEndTime);
    
    newItinerary[currentActivityIndex] = {
      ...currentActivity,
      end_time: newEndTime,
      estimated_duration: (currentActivity.estimated_duration || 0) + delayMinutes,
    };
    
    // Push ALL subsequent activities by delayMinutes
    console.log("[Schedule Adjustment] Pushing", newItinerary.length - currentActivityIndex - 1, "subsequent activities by", delayMinutes, "minutes");
    for (let i = currentActivityIndex + 1; i < newItinerary.length; i++) {
      const activity = newItinerary[i];
      const oldStartTime = activity.start_time;
      const oldEndTime = activity.end_time;
      
      if (activity.start_time) {
        activity.start_time = addMinutesToTime(activity.start_time, delayMinutes);
        console.log(`[Schedule Adjustment] Activity ${i} (${activity.name}): ${oldStartTime} -> ${activity.start_time}`);
      }
      if (activity.end_time) {
        activity.end_time = addMinutesToTime(activity.end_time, delayMinutes);
        console.log(`[Schedule Adjustment] Activity ${i} (${activity.name}): end ${oldEndTime} -> ${activity.end_time}`);
      }
      newItinerary[i] = activity;
    }
    
    console.log("[Schedule Adjustment] ===== NEW ITINERARY TIMES (after adjustment) =====");
    newItinerary.forEach((act, idx) => {
      console.log(`[Schedule Adjustment]   [${idx}] ${act.name} - start: "${act.start_time || 'N/A'}", end: "${act.end_time || 'N/A'}"`);
    });
    console.log("-----------------------------------------------------------------------------------------------------------------------------------");

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
    console.error('Failed to find shorter alternatives:', error);
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
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

/**
 * Parse time string to Date object
 */
export function parseTimeToDate(timeString: string, baseDate: Date): Date {
  // Safety check for undefined/null timeString
  if (!timeString || typeof timeString !== 'string') {
    console.warn('[ScheduleManager] Invalid timeString:', timeString);
    return new Date(baseDate); // Return baseDate as fallback
  }
  
  const parts = timeString.split(':');
  if (parts.length !== 2) {
    console.warn('[ScheduleManager] Invalid time format:', timeString);
    return new Date(baseDate); // Return baseDate as fallback
  }
  
  const [hours, minutes] = parts.map(Number);
  
  // Validate hours and minutes
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours >= 24 || minutes < 0 || minutes >= 60) {
    console.warn('[ScheduleManager] Invalid time values:', timeString, `hours: ${hours}, minutes: ${minutes}`);
    return new Date(baseDate); // Return baseDate as fallback
  }
  
  const date = new Date(baseDate);
  date.setHours(hours, minutes, 0, 0);
  
  // If the parsed time is earlier than baseDate and the difference is more than 12 hours,
  // it's likely meant for the next day (e.g., if baseDate is 10 AM and timeString is "09:00", it should be 9 AM tomorrow)
  // But for schedule status checks, we typically want same-day times, so we only adjust if it's clearly wrong
  // Actually, let's not auto-adjust here - let the caller handle date logic
  
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
    console.error('Failed to save schedule adjustment:', error);
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
    console.error('Failed to get last schedule adjustment:', error);
    return null;
  }
}
