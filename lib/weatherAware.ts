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
 * Enhanced weather API call with more detailed data
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
 * Adapt itinerary based on current weather
 */
export async function adaptItineraryForWeather(
  itinerary: any[],
  userLocation: { lat: number; lng: number },
  currentActivityIndex: number = 0
): Promise<{ adaptedItinerary: any[]; changes: string[] }> {
  try {
    console.log('Adapting itinerary for weather...');
    
    const weather = await getDetailedWeather(userLocation.lat, userLocation.lng);
    if (!weather) {
      console.warn('Could not fetch weather data, skipping adaptation');
      return { adaptedItinerary: itinerary, changes: [] };
    }

    console.log(`Current weather: ${weather.condition} (${weather.temperature} C)`);
    
    const changes: string[] = [];
    const adaptedItinerary = [...itinerary];
    
    // Only adapt future activities (not completed ones)
    for (let i = currentActivityIndex; i < adaptedItinerary.length; i++) {
      const activity = adaptedItinerary[i];
      const assessment = assessWeatherImpact(weather, activity);
      
      if (assessment.shouldAdapt) {
        console.log(`Adapting activity: ${activity.name}`);
        
        // Find indoor alternatives
        const alternatives = await findIndoorAlternatives(activity, userLocation);
        
        if (alternatives.length > 0) {
          const bestAlternative = alternatives[0];
          
          // Replace the outdoor activity with indoor alternative
          adaptedItinerary[i] = {
            ...bestAlternative,
            originalActivity: activity.name,
            adaptationReason: assessment.reason,
            start_time: activity.start_time,
            end_time: activity.end_time,
            estimated_duration: activity.estimated_duration,
            travel_time_minutes: activity.travel_time_minutes,
            travel_instructions: activity.travel_instructions,
          };
          
          changes.push(`Replaced "${activity.name}" with "${bestAlternative.name}" due to ${weather.condition}`);
        } else {
          // If no alternatives found, add a note
          adaptedItinerary[i] = {
            ...activity,
            weatherWarning: `Outdoor activity - ${weather.condition} expected`,
            adaptationReason: 'No suitable indoor alternatives found',
          };
          
          changes.push(`Added weather warning for "${activity.name}"`);
        }
      }
    }
    
    // Save weather data for fatigue calculations
    await saveWeatherContext(weather, userLocation);
    
    return { adaptedItinerary, changes };
    
  } catch (error) {
    console.error('Failed to adapt itinerary for weather:', error);
    return { adaptedItinerary: itinerary, changes: [] };
  }
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
