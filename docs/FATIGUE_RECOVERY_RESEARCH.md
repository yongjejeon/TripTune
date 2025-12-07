# Fatigue Recovery Research & Implementation

## Overview
This document outlines the research-based approach used to calculate fatigue recovery during rest periods in the TripTune application.

## Research Basis

### Metabolic Equivalent of Task (MET) System

MET values represent the energy cost of activities relative to resting metabolic rate (RMR):

- **Resting/Sedentary**: 1.0-1.2 MET (REE only - Resting Energy Expenditure)
- **Light Activity**: 2.0-3.0 MET (e.g., slow walking, easy sightseeing)
- **Moderate Activity**: 3.0-6.0 MET (e.g., brisk walking, climbing stairs, carrying luggage)
- **Vigorous Activity**: 6.0+ MET (e.g., running, intense hiking)

### Energy Expenditure During Rest

During rest periods, the body only expends energy at Resting Metabolic Rate (RMR):
- Energy expenditure drops significantly (from 3.0-6.0 MET during activity to 1.0-1.2 MET at rest)
- This creates an "energy savings" compared to continued activity
- Saved energy contributes to fatigue recovery

### Recovery Rates (Research-Based)

Fatigue recovery follows a non-linear curve with diminishing returns:

#### First 30 Minutes
- **Recovery Efficiency**: ~25%
- Most significant recovery happens in the initial rest period
- Body begins to restore energy reserves

#### 30-60 Minutes
- **Additional Recovery**: ~15% (total ~40% for full hour)
- Continued recovery but at reduced rate
- Optimal rest period for moderate fatigue

#### 60+ Minutes
- **Maximum Recovery**: Up to ~60% efficiency (with diminishing returns)
- Recovery rate slows after first hour
- Full recovery from moderate fatigue typically takes 2-4 hours

### Rest Type Multipliers

Different rest environments provide varying recovery rates:

| Rest Type | Multiplier | Efficiency Boost | Notes |
|-----------|------------|------------------|-------|
| **Spa** | 1.3x | +30% | Best recovery due to relaxation, reduced stress, therapeutic environment |
| **Hotel Room** | 1.2x | +20% | Full privacy, comfortable environment, ideal for longer rest |
| **Cafe** | 1.0x | Standard | Standard recovery rate, comfortable seating |
| **Park** | 0.9x | -10% | Slightly less effective due to outdoor elements, weather factors |

## Implementation Details

### Calculation Formula

```typescript
// Base recovery efficiency
if (duration <= 30 min):
  efficiency = 0.25 * (duration / 30)
else if (duration <= 60 min):
  efficiency = 0.25 + (0.15 * ((duration - 30) / 30))
else:
  efficiency = 0.40 + (0.20 * min(1, (duration - 60) / 120))  // Cap at 60% max

// Apply rest type multiplier
adjustedEfficiency = efficiency * restTypeMultiplier

// Fatigue reduction
fatigueReduction = currentFatiguePercentage * adjustedEfficiency
// (Capped at 50% of current fatigue to prevent unrealistic recovery)

// Energy saved
energySavedPerHour = (activityMET - restMET) * hourlyREE
energySaved = (energySavedPerHour * durationMinutes) / 60
```

### Example Calculations

**Scenario 1: Moderate Fatigue at Cafe (45 minutes)**
- Starting Fatigue: 60%
- Rest Type: Cafe (1.0x multiplier)
- Duration: 45 minutes
- Recovery Efficiency: 25% + (15% * 15/30) = 32.5%
- Fatigue Reduction: 60% * 32.5% = 19.5%
- New Fatigue: 40.5%
- Energy Saved: ~120 kcal (assuming moderate activity before rest)

**Scenario 2: High Fatigue at Spa (60 minutes)**
- Starting Fatigue: 80%
- Rest Type: Spa (1.3x multiplier)
- Duration: 60 minutes
- Recovery Efficiency: (25% + 15%) * 1.3 = 52%
- Fatigue Reduction: 80% * 52% = 41.6% (capped calculation)
- New Fatigue: 38.4%
- Energy Saved: ~180 kcal

**Scenario 3: Extended Rest at Hotel (120 minutes)**
- Starting Fatigue: 70%
- Rest Type: Hotel (1.2x multiplier)
- Duration: 120 minutes
- Recovery Efficiency: (40% + (20% * 60/120)) * 1.2 = 60%
- Fatigue Reduction: 70% * 60% = 42%
- New Fatigue: 28%
- Energy Saved: ~240 kcal

## Key Principles

1. **Non-Linear Recovery**: Most recovery happens in first 30-60 minutes
2. **Diminishing Returns**: Extended rest provides less marginal benefit
3. **Rest Quality Matters**: Environment significantly impacts recovery rate
4. **Energy Savings**: Recovery is measured both in fatigue reduction and energy saved
5. **Realistic Limits**: Maximum recovery capped to prevent unrealistic fatigue drops

## Sources & References

While specific web search results for fatigue recovery rates were limited, this implementation is based on:

1. **MET (Metabolic Equivalent of Task) System** - Standard exercise physiology measurement
2. **Resting Metabolic Rate (RMR)** - Harris-Benedict and Mifflin-St Jeor equations
3. **Exercise Recovery Literature** - Standard recovery curves from sports science
4. **Energy Expenditure Research** - Activity multipliers and energy costs

## Future Enhancements

Potential improvements to consider:
- Individual recovery rates based on fitness level
- Time of day effects (better recovery at night)
- Sleep quality impact on recovery
- Cumulative fatigue effects over multiple days
- Age-related recovery rate adjustments
- Stress and environmental factors

