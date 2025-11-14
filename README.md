## TripTune

TripTune is an Expo-based React Native application for planning and adapting multi-day travel itineraries. It integrates AI itinerary generation, weather-aware adaptation, schedule tracking, and a fatigue model informed by health and activity data.

### High-level architecture

- `app/` - UI, navigation, and screens using Expo Router (file-based routing).
  - `app/(root)/(tabs)/index.tsx` - Integrated onboarding: personal info, dates, accommodation (GPS or city), and place selection with smart preference inference.
  - `app/(root)/(tabs)/explore.tsx` - Core planning screen: generate single-day and multi-day trips, schedule tracking, weather checks, and itinerary display.
  - `app/sign-in.tsx` - Sign-in screen; after sign-in routes to Galaxy Watch onboarding.
  - `app/(root)/onboarding/` - Galaxy Watch connection and heart-rate capture.
- `lib/` - Domain logic and integrations.
  - `lib/itineraryAI.ts` - GPT-driven single-day itinerary generation (duplicate-avoidance, anchors).
  - `lib/multidayPlanner.ts` - Multi-day orchestration, anchor assignment, duplicate prevention, enrichment and optimization.
  - `lib/itineraryOptimizer.ts` - Route optimization, realistic timing, and smart meal insertion.
  - `lib/routeOptimizer.ts` - Travel graph and path construction.
  - `lib/weatherAware.ts` - Weather fetch and itinerary adaptation rules.
  - `lib/scheduleManager.ts` - Detect behind-schedule status and propose adjustments.
  - `lib/google.ts` - Google Places API (with photos), enriched place objects.
  - `lib/preferences.ts` - Smart preference inference from selected places; avoid list helpers.
  - `lib/health.ts` - Heart rate access helpers and aggressive polling strategies.
  - `lib/global-provider.tsx` - App-wide state provider.

### Single-terminal launch (recommended)

Run both commands in the same terminal, in order. The second command will auto-start Metro if it is not running and stream logs in the same window.

```bash
pkill -f "expo start" || true
npx expo run:android
```

Notes:
- If you see "Waiting on http://localhost:8081" for too long, it usually means another Metro is blocking the default port. Re-run the two commands above to clear stale Metro and start fresh.
- To view native and JavaScript logs regardless of Metro, you can use:

```bash
adb logcat *:S ReactNativeJS:V ReactNative:V Expo:V
```

### Notes

- This project uses Expo Router and requires the app to be launched via a development build (not Expo Go) for full feature support.
- Ensure the required environment variables are present (.env.local) for Google Places and OpenWeather integrations.
