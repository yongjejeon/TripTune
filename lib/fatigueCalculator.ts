// lib/fatigueCalculator.ts - Energy Expenditure and Fatigue Calculation
// Based on heart rate-derived energy expenditure formulas

export interface UserProfile {
  gender: 'male' | 'female';
  age: number; // years
  weight: number; // kg
  height: number; // cm
}

export enum FatigueLevel {
  RESTED = "Rested",
  LIGHT = "Light",
  MODERATE = "Moderate",
  HIGH = "High",
  EXHAUSTED = "Exhausted",
}

export interface FatigueData {
  level: FatigueLevel;
  percentage: number; // 0-100, percentage of daily energy budget used
  currentEE: number; // Current energy expenditure (kcal/hour)
  dailyREE: number; // Resting energy expenditure (kcal/day)
  totalEEToday: number; // Total energy spent today (kcal)
  budgetRemaining: number; // Energy budget remaining (kcal)
  message: string;
  recommendation: string;
}

/**
 * Calculate Resting Energy Expenditure (REE) using Mifflin-St Jeor Equation
 * More accurate than Harris-Benedict for modern populations
 */
export function calculateREE(profile: UserProfile): number {
  const { gender, age, weight, height } = profile;
  
  if (gender === 'male') {
    // REE_men (kcal/day) = 66.5 + (13.75 × weight_kg) + (5.003 × height_cm) − (6.775 × age)
    return 66.5 + (13.75 * weight) + (5.003 * height) - (6.775 * age);
  } else {
    // REE_women (kcal/day) = 655.1 + (9.563 × weight_kg) + (1.850 × height_cm) − (4.676 × age)
    return 655.1 + (9.563 * weight) + (1.850 * height) - (4.676 * age);
  }
}

/**
 * Calculate current Energy Expenditure from heart rate (J/min)
 * Based on Polar RS400 formula for heart rate-derived energy expenditure
 */
export function calculateEnergyExpenditureFromHR(
  heartRate: number,
  profile: UserProfile
): number {
  const { gender, age, weight } = profile;
  
  let eeJoulesPerMin: number;
  
  if (gender === 'male') {
    // Male: EE (J/min) = −55.0969 + 0.6309 × HR + 0.1988 × weight (kg) + 0.2017 × age (yrs)
    eeJoulesPerMin = -55.0969 + (0.6309 * heartRate) + (0.1988 * weight) + (0.2017 * age);
  } else {
    // Female: EE (J/min) = −20.4022 + 0.4472 × HR − 0.1263 × weight (kg) + 0.074 × age (yrs)
    eeJoulesPerMin = -20.4022 + (0.4472 * heartRate) - (0.1263 * weight) + (0.074 * age);
  }
  
  // Convert J/min to kcal/hour
  // 1 kcal = 4184 J
  // 1 hour = 60 min
  let eeKcalPerHour = (eeJoulesPerMin * 60) / 4184;
  
  // At resting heart rates (60-85), the formula underestimates
  // Use REE as baseline for resting states
  if (heartRate < 85) {
    const reeDaily = calculateREE(profile);
    const restingRatePerHour = reeDaily / 24;
    // Use the higher of formula result or resting rate
    eeKcalPerHour = Math.max(eeKcalPerHour, restingRatePerHour);
  }
  
  return Math.max(0, eeKcalPerHour); // Ensure non-negative
}

/**
 * Get activity level multiplier based on travel intensity
 */
export function getActivityMultiplier(activityLevel: 'sedentary' | 'light' | 'moderate' | 'vigorous'): number {
  switch (activityLevel) {
    case 'sedentary': return 1.2; // Resting
    case 'light': return 1.55; // Easy walking, light travel (1.5-1.6 average)
    case 'moderate': return 1.75; // Urban walking with stairs, carrying load (1.7-1.8 average)
    case 'vigorous': return 2.0; // Long hikes, strenuous activities
    default: return 1.55; // Default to light travel
  }
}

/**
 * Calculate total daily energy budget based on activity level
 */
export function calculateDailyEnergyBudget(
  profile: UserProfile,
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'vigorous' = 'light'
): number {
  const ree = calculateREE(profile);
  const multiplier = getActivityMultiplier(activityLevel);
  return ree * multiplier;
}

/**
 * Estimate total energy expenditure so far today
 * Based on accumulated heart rate data throughout the day
 * For now, simplified estimation - can be enhanced with historical data
 */
export function estimateTotalEEToday(
  currentHR: number,
  profile: UserProfile,
  hoursAwake: number = 8 // Default assumption
): number {
  const currentEE = calculateEnergyExpenditureFromHR(currentHR, profile);
  const ree = calculateREE(profile);
  
  // Estimate: REE for baseline + current activity rate for hours awake
  // This is simplified - in production, you'd track actual HR throughout the day
  const baselineToday = (ree / 24) * hoursAwake; // REE portion for hours awake
  const activityToday = currentEE * hoursAwake; // Assume current activity level maintained
  
  return baselineToday + (activityToday * 0.5); // Scale down activity portion (conservative estimate)
}

/**
 * Determine fatigue level based on percentage of daily energy budget used
 */
export function getFatigueLevel(percentage: number): FatigueLevel {
  if (percentage < 30) return FatigueLevel.RESTED;
  if (percentage < 50) return FatigueLevel.LIGHT;
  if (percentage < 70) return FatigueLevel.MODERATE;
  if (percentage < 90) return FatigueLevel.HIGH;
  return FatigueLevel.EXHAUSTED;
}

/**
 * Get message and recommendation based on fatigue level
 */
function getFatigueMessage(level: FatigueLevel): { message: string; recommendation: string } {
  switch (level) {
    case FatigueLevel.RESTED:
      return {
        message: "You're feeling great and energized!",
        recommendation: "Perfect time for exploring and activities.",
      };
    case FatigueLevel.LIGHT:
      return {
        message: "Energy levels are good.",
        recommendation: "Continue at this pace, stay hydrated.",
      };
    case FatigueLevel.MODERATE:
      return {
        message: "Moderate fatigue detected.",
        recommendation: "Consider taking a short break soon. Find a café or park to rest.",
      };
    case FatigueLevel.HIGH:
      return {
        message: "High fatigue - you're working hard!",
        recommendation: "Time for a significant rest. Find a comfortable place to sit and relax for 30+ minutes.",
      };
    case FatigueLevel.EXHAUSTED:
      return {
        message: "You're exhausted! Critical rest needed.",
        recommendation: "Stop current activities. Return to hotel or find a quiet place to rest for at least an hour.",
      };
  }
}

/**
 * Calculate comprehensive fatigue data from current heart rate
 */
export function calculateFatigue(
  currentHeartRate: number,
  profile: UserProfile,
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'vigorous' = 'light',
  hoursAwake: number = 8
): FatigueData {
  // Calculate current energy expenditure
  const currentEE = calculateEnergyExpenditureFromHR(currentHeartRate, profile);
  
  // Calculate daily budget
  const dailyREE = calculateREE(profile);
  const dailyBudget = calculateDailyEnergyBudget(profile, activityLevel);
  
  // Estimate total spent today
  const totalEEToday = estimateTotalEEToday(currentHeartRate, profile, hoursAwake);
  
  // Calculate percentage of budget used
  const percentage = Math.min(100, (totalEEToday / dailyBudget) * 100);
  
  // Determine fatigue level
  const level = getFatigueLevel(percentage);
  const { message, recommendation } = getFatigueMessage(level);
  
  // Calculate remaining budget
  const budgetRemaining = Math.max(0, dailyBudget - totalEEToday);
  
  return {
    level,
    percentage: Math.round(percentage),
    currentEE: Math.round(currentEE),
    dailyREE: Math.round(dailyREE),
    totalEEToday: Math.round(totalEEToday),
    budgetRemaining: Math.round(budgetRemaining),
    message,
    recommendation,
  };
}

/**
 * Calculate fatigue WITHOUT heart rate data
 * Uses REE formula with estimated activity level
 * Assumes a default walking heart rate (100 BPM for light walking)
 */
export function calculateFatigueWithoutHR(
  profile: UserProfile,
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'vigorous' = 'light',
  hoursAwake: number = 8
): FatigueData {
  // Use default walking heart rate when no HR data available
  // Light walking typically 90-110 BPM, we'll use 100 BPM as middle ground
  const defaultWalkingHR = 100;
  
  console.log('[Fatigue] No HR data, using default walking HR:', defaultWalkingHR);
  
  // Calculate current energy expenditure based on default walking HR
  const currentEE = calculateEnergyExpenditureFromHR(defaultWalkingHR, profile);
  
  // Calculate daily budget
  const dailyREE = calculateREE(profile);
  const dailyBudget = calculateDailyEnergyBudget(profile, activityLevel);
  
  // Estimate total spent today based on time awake and activity level
  // More conservative estimation without HR data
  const avgHourlyEE = (dailyBudget / 24) * getActivityMultiplier(activityLevel);
  const totalEEToday = avgHourlyEE * hoursAwake;
  
  // Calculate percentage of budget used
  const percentage = Math.min(100, (totalEEToday / dailyBudget) * 100);
  
  // Determine fatigue level
  const level = getFatigueLevel(percentage);
  const { message, recommendation } = getFatigueMessage(level);
  
  // Calculate remaining budget
  const budgetRemaining = Math.max(0, dailyBudget - totalEEToday);
  
  return {
    level,
    percentage: Math.round(percentage),
    currentEE: Math.round(currentEE),
    dailyREE: Math.round(dailyREE),
    totalEEToday: Math.round(totalEEToday),
    budgetRemaining: Math.round(budgetRemaining),
    message: message + " (estimated without HR data)",
    recommendation,
  };
}

/**
 * Quick fatigue check - simplified version for quick status
 */
export function quickFatigueCheck(
  currentHeartRate: number,
  restingHeartRate: number = 70
): { level: FatigueLevel; message: string } {
  // Simple heuristic based on heart rate elevation
  const elevation = currentHeartRate - restingHeartRate;
  const percentElevation = (elevation / restingHeartRate) * 100;
  
  if (percentElevation < 10) {
    return { level: FatigueLevel.RESTED, message: "Heart rate near resting - well rested" };
  } else if (percentElevation < 30) {
    return { level: FatigueLevel.LIGHT, message: "Light activity detected" };
  } else if (percentElevation < 50) {
    return { level: FatigueLevel.MODERATE, message: "Moderate activity - take breaks" };
  } else if (percentElevation < 70) {
    return { level: FatigueLevel.HIGH, message: "High exertion - rest soon" };
  } else {
    return { level: FatigueLevel.EXHAUSTED, message: "Very high exertion - rest now" };
  }
}

// For testing/simulation purposes
let fatigueOverride: FatigueLevel | null = null;

export function setFatigueOverride(level: FatigueLevel | null) {
  fatigueOverride = level;
  console.log(`[Fatigue] Override set to: ${level}`);
}

export function getFatigueOverride(): FatigueLevel | null {
  return fatigueOverride;
}

export function hasFatigueOverride(): boolean {
  return fatigueOverride !== null;
}

/**
 * Calculate fatigue recovery during rest periods
 * Based on MET (Metabolic Equivalent of Task) research:
 * - Resting: 1.0-1.2 MET (REE only)
 * - Light activity: 2.0-3.0 MET
 * - Moderate activity: 3.0-6.0 MET
 * - Vigorous activity: 6.0+ MET
 * 
 * Recovery rates (based on research):
 * - First 30 min: 20-30% fatigue reduction
 * - 30-60 min: Additional 10-20% reduction
 * - 60+ min: Diminishing returns but continues
 */
export interface RestRecoveryData {
  fatigueReduction: number; // Percentage points reduced (e.g., 15%)
  energySaved: number; // kcal saved during rest period
  newFatiguePercentage: number; // Updated fatigue percentage after rest
  recoveryEfficiency: number; // Recovery efficiency (0-1)
}

/**
 * Calculate fatigue recovery from rest period
 * @param currentFatiguePercentage Current fatigue percentage (0-100)
 * @param restDurationMinutes Duration of rest in minutes
 * @param activityLevelBeforeRest Activity level before rest (to calculate energy saved)
 * @param profile User profile for REE calculation
 * @returns Recovery data
 */
export function calculateRestRecovery(
  currentFatiguePercentage: number,
  restDurationMinutes: number,
  activityLevelBeforeRest: 'sedentary' | 'light' | 'moderate' | 'vigorous' = 'moderate',
  profile: UserProfile
): RestRecoveryData {
  // Calculate hourly REE
  const dailyREE = calculateREE(profile);
  const hourlyREE = dailyREE / 24;
  
  // Calculate what energy would have been burned at previous activity level
  const activityMultiplier = getActivityMultiplier(activityLevelBeforeRest);
  const hourlyEEBeforeRest = hourlyREE * activityMultiplier;
  
  // During rest, only REE is burned (1.0 MET = sedentary)
  const hourlyEEDuringRest = hourlyREE * 1.2; // 1.2 = sedentary multiplier
  
  // Energy saved per hour during rest
  const energySavedPerHour = hourlyEEBeforeRest - hourlyEEDuringRest;
  const energySaved = (energySavedPerHour * restDurationMinutes) / 60;
  
  // Recovery rate based on duration (non-linear, diminishing returns)
  let recoveryEfficiency: number;
  if (restDurationMinutes <= 30) {
    // First 30 min: 25% recovery efficiency
    recoveryEfficiency = 0.25 * (restDurationMinutes / 30);
  } else if (restDurationMinutes <= 60) {
    // 30-60 min: 25% + additional 15% = 40% total
    const first30min = 0.25;
    const additional = 0.15 * ((restDurationMinutes - 30) / 30);
    recoveryEfficiency = first30min + additional;
  } else {
    // 60+ min: 40% + diminishing returns (up to 60% max)
    const first60min = 0.40;
    const additional = 0.20 * Math.min(1, (restDurationMinutes - 60) / 120); // Up to 3 hours total
    recoveryEfficiency = Math.min(0.60, first60min + additional);
  }
  
  // Calculate fatigue reduction
  // Recovery is proportional to current fatigue level
  // Higher fatigue = more recovery potential
  const maxRecoverableFatigue = currentFatiguePercentage * recoveryEfficiency;
  const fatigueReduction = Math.min(maxRecoverableFatigue, currentFatiguePercentage * 0.5); // Cap at 50% of current
  
  // New fatigue percentage
  const newFatiguePercentage = Math.max(0, currentFatiguePercentage - fatigueReduction);
  
  return {
    fatigueReduction: Math.round(fatigueReduction * 10) / 10, // Round to 1 decimal
    energySaved: Math.round(energySaved),
    newFatiguePercentage: Math.round(newFatiguePercentage * 10) / 10,
    recoveryEfficiency: Math.round(recoveryEfficiency * 100) / 100,
  };
}

/**
 * Calculate recovery for specific rest types
 * Different rest types have different recovery rates
 */
export function calculateRestRecoveryByType(
  currentFatiguePercentage: number,
  restDurationMinutes: number,
  restType: 'cafe' | 'spa' | 'park' | 'hotel',
  activityLevelBeforeRest: 'sedentary' | 'light' | 'moderate' | 'vigorous' = 'moderate',
  profile: UserProfile
): RestRecoveryData {
  // Base recovery calculation
  const baseRecovery = calculateRestRecovery(
    currentFatiguePercentage,
    restDurationMinutes,
    activityLevelBeforeRest,
    profile
  );
  
  // Apply multipliers based on rest type
  let typeMultiplier = 1.0;
  switch (restType) {
    case 'spa':
      // Spa provides best recovery (relaxation, reduced stress)
      typeMultiplier = 1.3; // 30% better recovery
      break;
    case 'hotel':
      // Hotel room (full rest, comfortable environment)
      typeMultiplier = 1.2; // 20% better recovery
      break;
    case 'cafe':
      // Cafe (sitting, but still some stimulation)
      typeMultiplier = 1.0; // Standard recovery
      break;
    case 'park':
      // Park (outdoor, but still restful)
      typeMultiplier = 0.9; // Slightly less effective (outdoor elements)
      break;
  }
  
  // Apply type multiplier to fatigue reduction
  const adjustedFatigueReduction = baseRecovery.fatigueReduction * typeMultiplier;
  const newFatiguePercentage = Math.max(0, currentFatiguePercentage - adjustedFatigueReduction);
  
  return {
    fatigueReduction: Math.round(adjustedFatigueReduction * 10) / 10,
    energySaved: baseRecovery.energySaved,
    newFatiguePercentage: Math.round(newFatiguePercentage * 10) / 10,
    recoveryEfficiency: Math.round(baseRecovery.recoveryEfficiency * typeMultiplier * 100) / 100,
  };
}

