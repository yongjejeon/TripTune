// lib/weatherAware.ts - Real-time weather-aware itinerary adaptation
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchPlacesByCoordinates } from './google';

export interface WeatherData {
  condition: string;
  temperature: number;
  humidity: number;
  windSpeed: number;
  description: string;
  icon: string;
  timestamp: string;
}

export interface WeatherAdaptation {
  shouldAdapt: boolean;
  reason: string;
  suggestedChanges: string[];
  indoorAlternatives: any[];
}

// Enhanced weather conditions with severity levels
export const WEATHER_CONDITIONS = {
  EXCELLENT: ['Clear', 'Sunny'],
  GOOD: ['Clouds', 'Partly Cloudy'],
  MODERATE: ['Overcast', 'Fog', 'Mist'],
  POOR: ['Rain', 'Drizzle', 'Light Rain'],
  SEVERE: ['Thunderstorm', 'Heavy Rain', 'Snow', 'Blizzard', 'Hail'],
} as const;

export const BAD_WEATHER = [
  ...WEATHER_CONDITIONS.POOR,
  ...WEATHER_CONDITIONS.SEVERE,
];

// Activity types that are weather-sensitive
export const WEATHER_SENSITIVE_ACTIVITIES = {
  OUTDOOR_ONLY: ['park', 'beach', 'outdoor_market', 'hiking', 'outdoor_sports'],
  OUTDOOR_PREFERRED: ['landmark', 'monument', 'outdoor_attraction', 'garden'],
  INDOOR_SAFE: ['museum', 'art_gallery', 'aquarium', 'zoo', 'shopping_mall', 'cafe', 'restaurant'],
  WEATHER_NEUTRAL: ['religious_sites', 'palace', 'fort', 'indoor_attraction'],
} as const;

/**
 * Enhanced weather API call with more detailed data (current weather)
 */
export async function getDetailedWeather(lat: number, lon: number): Promise<WeatherData | null> {
  try {
    const API_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_KEY;
    if (!API_KEY) {
      console.error('OpenWeather API key not found');
      return null;
    }

    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`
    );
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();
    
    return {
      condition: data.weather[0]?.main || 'Unknown',
      temperature: Math.round(data.main?.temp || 0),
      humidity: data.main?.humidity || 0,
      windSpeed: data.wind?.speed || 0,
      description: data.weather[0]?.description || '',
      icon: data.weather[0]?.icon || '',
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Failed to fetch detailed weather:', error);
    return null;
  }
}

/**
 * Get weather forecast for a specific date (for itinerary planning)
 * Returns forecast weather or null if unavailable (assume sunny)
 */
export async function getWeatherForecastForDate(
  lat: number,
  lon: number,
  date: string // ISO date string like "2025-11-24"
): Promise<WeatherData | null> {
  try {
    const API_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_KEY;
    if (!API_KEY) {
      console.error('OpenWeather API key not found');
      return null;
    }

    const targetDate = new Date(date);
    const now = new Date();
    const daysDifference = Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // OpenWeather forecast is available for up to 5 days
    if (daysDifference < 0 || daysDifference > 5) {
      console.log(`Weather forecast unavailable for date ${date} (${daysDifference} days away), assuming sunny`);
      return null; // Will default to sunny weather
    }

    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`
    );
    
    if (!response.ok) {
      console.warn(`Weather forecast API error: ${response.status}, assuming sunny`);
      return null;
    }

    const data = await response.json();
    
    // Find the forecast closest to noon on the target date
    const targetNoon = new Date(targetDate);
    targetNoon.setHours(12, 0, 0, 0);
    
    let closestForecast = null;
    let smallestDiff = Infinity;
    
    for (const item of data.list || []) {
      const forecastTime = new Date(item.dt * 1000);
      const diff = Math.abs(forecastTime.getTime() - targetNoon.getTime());
      
      if (diff < smallestDiff) {
        smallestDiff = diff;
        closestForecast = item;
      }
    }
    
    if (closestForecast) {
      return {
        condition: closestForecast.weather[0]?.main || 'Clear',
        temperature: Math.round(closestForecast.main?.temp || 20),
        humidity: closestForecast.main?.humidity || 0,
        windSpeed: closestForecast.wind?.speed || 0,
        description: closestForecast.weather[0]?.description || '',
        icon: closestForecast.weather[0]?.icon || '',
        timestamp: new Date(closestForecast.dt * 1000).toISOString(),
      };
    }
    
    return null; // Will default to sunny
  } catch (error) {
    console.error('Failed to fetch weather forecast:', error);
    return null; // Will default to sunny
  }
}

/**
 * Check if weather condition indicates rain
 */
export function isRaining(weather: WeatherData | null): boolean {
  if (!weather) return false;
  return BAD_WEATHER.includes(weather.condition);
}

/**
 * Determine if weather requires itinerary adaptation
 */
export function assessWeatherImpact(weather: WeatherData, activity: any): WeatherAdaptation {
  const isOutdoor = isActivityOutdoor(activity);
  const isWeatherSensitive = isActivityWeatherSensitive(activity);
  
  if (!isOutdoor || !isWeatherSensitive) {
    return {
      shouldAdapt: false,
      reason: 'Activity is not weather-sensitive',
      suggestedChanges: [],
      indoorAlternatives: [],
    };
  }

  const weatherSeverity = getWeatherSeverity(weather.condition);
  
  if (weatherSeverity === 'EXCELLENT' || weatherSeverity === 'GOOD') {
    return {
      shouldAdapt: false,
      reason: 'Weather conditions are suitable for outdoor activities',
      suggestedChanges: [],
      indoorAlternatives: [],
    };
  }

  const adaptation: WeatherAdaptation = {
    shouldAdapt: true,
    reason: `Weather condition "${weather.condition}" is not suitable for outdoor activities`,
    suggestedChanges: [],
    indoorAlternatives: [],
  };

  // Generate specific suggestions based on weather severity
  if (weatherSeverity === 'POOR') {
    adaptation.suggestedChanges.push('Consider indoor alternatives');
    adaptation.suggestedChanges.push('Bring umbrella or rain gear');
    adaptation.suggestedChanges.push('Check if venue has covered areas');
  } else if (weatherSeverity === 'SEVERE') {
    adaptation.suggestedChanges.push('Strongly recommend indoor alternatives');
    adaptation.suggestedChanges.push('Avoid outdoor activities');
    adaptation.suggestedChanges.push('Consider postponing if possible');
  }

  return adaptation;
}

/**
 * Find indoor alternatives for outdoor activities
 */
export async function findIndoorAlternatives(
  outdoorActivity: any,
  userLocation: { lat: number; lng: number },
  maxDistance: number = 5 // km
): Promise<any[]> {
  try {
    console.log(`Finding indoor alternatives for: ${outdoorActivity.name}`);
    
    // Get nearby places
    const nearbyPlaces = await fetchPlacesByCoordinates(userLocation.lat, userLocation.lng);
    
    // Filter for indoor alternatives
    const indoorAlternatives = nearbyPlaces.filter(place => {
      const isIndoor = place.category === 'indoor' || place.category === 'both';
      const isGoodRating = (place.rating || 0) >= 3.5;
      const isRelevant = isRelevantAlternative(outdoorActivity, place);
      
      return isIndoor && isGoodRating && isRelevant;
    });

    // Sort by relevance and rating
    return indoorAlternatives
      .sort((a, b) => {
        const relevanceScoreA = calculateRelevanceScore(outdoorActivity, a);
        const relevanceScoreB = calculateRelevanceScore(outdoorActivity, b);
        return relevanceScoreB - relevanceScoreA;
      })
      .slice(0, 3); // Return top 3 alternatives
      
  } catch (error) {
    console.error('Failed to find indoor alternatives:', error);
    return [];
  }
}

/**
 * Check for outdoor activities that need weather adaptation
 * Returns the first outdoor activity that needs replacement (current or upcoming)
 */
export async function checkWeatherForOutdoorActivities(
  itinerary: any[],
  userLocation: { lat: number; lng: number },
  currentActivityIndex: number = 0
): Promise<{
  needsAdaptation: boolean;
  activity: any | null;
  activityIndex: number;
  alternatives: any[];
  weather: WeatherData | null;
} | null> {
  try {
    const weather = await getDetailedWeather(userLocation.lat, userLocation.lng);
    if (!weather) {
      return null;
    }

    // Check if it's raining
    if (!isRaining(weather)) {
      return null;
    }

    // Only check remaining/current activities (not completed ones)
    for (let i = currentActivityIndex; i < itinerary.length; i++) {
      const activity = itinerary[i];
      const assessment = assessWeatherImpact(weather, activity);
      
      if (assessment.shouldAdapt) {
        console.log(`Rain detected, found outdoor activity that needs adaptation: ${activity.name}`);
        
        // Find indoor alternatives (get 3)
        const alternatives = await findIndoorAlternatives(activity, userLocation);
        
        if (alternatives.length > 0) {
          return {
            needsAdaptation: true,
            activity,
            activityIndex: i,
            alternatives: alternatives.slice(0, 3), // Return exactly 3
            weather,
          };
        }
      }
    }
    
    return null;
    
  } catch (error) {
    console.error('Failed to check weather for outdoor activities:', error);
    return null;
  }
}

/**
 * Adapt itinerary based on current weather (legacy function - kept for compatibility)
 * Note: This should not auto-replace, but the new checkWeatherForOutdoorActivities should be used instead
 */
export async function adaptItineraryForWeather(
  itinerary: any[],
  userLocation: { lat: number; lng: number },
  currentActivityIndex: number = 0
): Promise<{ adaptedItinerary: any[]; changes: string[] }> {
  // This function is deprecated - use checkWeatherForOutdoorActivities instead
  // Keeping it for backward compatibility but it should not auto-replace
  return { adaptedItinerary: itinerary, changes: [] };
}

/**
 * Helper functions
 */
function isActivityOutdoor(activity: any): boolean {
  const category = activity.category || activity.normalizedCategory || '';
  return category === 'outdoor' || 
         WEATHER_SENSITIVE_ACTIVITIES.OUTDOOR_ONLY.includes(category) ||
         WEATHER_SENSITIVE_ACTIVITIES.OUTDOOR_PREFERRED.includes(category);
}

function isActivityWeatherSensitive(activity: any): boolean {
  const category = activity.category || activity.normalizedCategory || '';
  return !WEATHER_SENSITIVE_ACTIVITIES.WEATHER_NEUTRAL.includes(category);
}

function getWeatherSeverity(condition: string): keyof typeof WEATHER_CONDITIONS {
  for (const [severity, conditions] of Object.entries(WEATHER_CONDITIONS)) {
    if (conditions.includes(condition)) {
      return severity as keyof typeof WEATHER_CONDITIONS;
    }
  }
  return 'MODERATE'; // Default fallback
}

function isRelevantAlternative(original: any, alternative: any): boolean {
  // Simple relevance check - could be enhanced with more sophisticated matching
  const originalCategory = original.category || original.normalizedCategory || '';
  const alternativeCategory = alternative.category || alternative.normalizedCategory || '';
  
  // Same category is most relevant
  if (originalCategory === alternativeCategory) return true;
  
  // Museum/art gallery alternatives for cultural sites
  if (originalCategory.includes('cultural') && alternativeCategory.includes('museum')) return true;
  
  // Shopping alternatives for markets
  if (originalCategory.includes('market') && alternativeCategory.includes('shopping')) return true;
  
  return false;
}

function calculateRelevanceScore(original: any, alternative: any): number {
  let score = 0;
  
  // Rating score
  score += (alternative.rating || 0) * 2;
  
  // Review count score
  score += Math.log10((alternative.user_ratings_total || 1) + 1);
  
  // Category relevance
  if (isRelevantAlternative(original, alternative)) {
    score += 5;
  }
  
  return score;
}

/**
 * Save weather context for fatigue calculations
 */
async function saveWeatherContext(weather: WeatherData, location: { lat: number; lng: number }) {
  try {
    const weatherContext = {
      ...weather,
      location,
      savedAt: new Date().toISOString(),
    };
    
    await AsyncStorage.setItem('currentWeatherContext', JSON.stringify(weatherContext));
    console.log('Weather context saved for fatigue calculations');
  } catch (error) {
    console.error('Failed to save weather context:', error);
  }
}

/**
 * Get weather forecast duration for harsh weather conditions
 * Returns the duration in minutes that harsh weather is expected to last
 * Returns null if not harsh weather or cannot determine duration
 */
export async function getHarshWeatherDuration(
  lat: number,
  lon: number
): Promise<{ durationMinutes: number; durationText: string } | null> {
  try {
    const API_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_KEY;
    if (!API_KEY) {
      console.error('OpenWeather API key not found');
      return null;
    }

    // Get current weather first
    const currentWeather = await getDetailedWeather(lat, lon);
    if (!currentWeather || !BAD_WEATHER.includes(currentWeather.condition)) {
      // Not harsh weather currently
      return null;
    }

    // Get forecast
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`
    );
    
    if (!response.ok) {
      console.warn(`Weather forecast API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const now = new Date();
    const currentCondition = currentWeather.condition;
    
    // Check forecast items in chronological order
    // Find when the weather condition changes from harsh to good
    let harshWeatherEndTime: Date | null = null;
    
    for (const item of data.list || []) {
      const forecastTime = new Date(item.dt * 1000);
      const forecastCondition = item.weather[0]?.main || 'Clear';
      
      // If forecast is in the future and still harsh weather, continue
      if (forecastTime > now && BAD_WEATHER.includes(forecastCondition)) {
        continue;
      }
      
      // If forecast shows good weather or is significantly in the future, mark end time
      if (forecastTime > now && !BAD_WEATHER.includes(forecastCondition)) {
        harshWeatherEndTime = forecastTime;
        break;
      }
    }
    
    // If we never found an end time, check the last forecast
    // If all forecasts show harsh weather, estimate based on last forecast
    if (!harshWeatherEndTime && data.list && data.list.length > 0) {
      const lastForecast = data.list[data.list.length - 1];
      const lastForecastTime = new Date(lastForecast.dt * 1000);
      const lastCondition = lastForecast.weather[0]?.main || 'Clear';
      
      if (BAD_WEATHER.includes(lastCondition)) {
        // All forecasts show harsh weather, use last forecast time + buffer
        harshWeatherEndTime = new Date(lastForecastTime.getTime() + 3 * 60 * 60 * 1000); // +3 hours
      }
    }
    
    if (!harshWeatherEndTime) {
      // Could not determine duration, assume 1 hour
      return {
        durationMinutes: 60,
        durationText: "about 1 hour"
      };
    }
    
    const durationMs = harshWeatherEndTime.getTime() - now.getTime();
    const durationMinutes = Math.max(1, Math.ceil(durationMs / (1000 * 60)));
    
    // Format duration text
    let durationText: string;
    if (durationMinutes < 60) {
      durationText = `${durationMinutes} minute${durationMinutes !== 1 ? 's' : ''}`;
    } else if (durationMinutes < 120) {
      durationText = "about 1 hour";
    } else {
      const hours = Math.floor(durationMinutes / 60);
      const mins = durationMinutes % 60;
      if (mins === 0) {
        durationText = `about ${hours} hour${hours !== 1 ? 's' : ''}`;
      } else {
        durationText = `about ${hours} hour${hours !== 1 ? 's' : ''} and ${mins} minute${mins !== 1 ? 's' : ''}`;
      }
    }
    
    return {
      durationMinutes,
      durationText
    };
  } catch (error) {
    console.error('Failed to get harsh weather duration:', error);
    return null;
  }
}

/**
 * Get saved weather context for fatigue calculations
 */
export async function getWeatherContext(): Promise<WeatherData | null> {
  try {
    const saved = await AsyncStorage.getItem('currentWeatherContext');
    if (saved) {
      const context = JSON.parse(saved);
      // Check if data is recent (within last hour)
      const savedTime = new Date(context.savedAt).getTime();
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      
      if (now - savedTime < oneHour) {
        return context;
      }
    }
    return null;
  } catch (error) {
    console.error('Failed to get weather context:', error);
    return null;
  }
}
