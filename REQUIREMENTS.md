# TripTune - Complete Requirements Document

## Document Information
- **Project Name**: TripTune
- **Version**: 1.0.0
- **Last Updated**: 2025-01-27
- **Document Type**: Software Requirements Specification (SRS)

---

## 1. INTRODUCTION

### 1.1 Purpose
TripTune is an Expo-based React Native mobile application that intelligently plans and adapts multi-day travel itineraries. The application integrates AI-powered itinerary generation, weather-aware adaptation, real-time schedule tracking, and a fatigue monitoring system informed by health and activity data from wearable devices.

### 1.2 Scope
TripTune provides:
- Multi-day trip planning with AI-generated itineraries
- Real-time health monitoring via Health Connect (Android)
- Fatigue calculation based on heart rate and user profile
- Weather-aware itinerary adaptation
- Schedule tracking and adjustment recommendations
- Place discovery and preference learning
- Route optimization for efficient travel

### 1.3 Definitions, Acronyms, and Abbreviations
- **BPM**: Beats Per Minute (heart rate)
- **REE**: Resting Energy Expenditure
- **EE**: Energy Expenditure
- **HC**: Health Connect (Android health data platform)
- **POI**: Point of Interest
- **TSP**: Traveling Salesman Problem (route optimization)
- **GPS**: Global Positioning System
- **OAuth**: Open Authorization
- **API**: Application Programming Interface
- **UI**: User Interface
- **UX**: User Experience

### 1.4 References
- Health Connect API Documentation
- Google Places API Documentation
- OpenAI GPT-4 API Documentation
- OpenWeather API Documentation
- React Native Documentation
- Expo Framework Documentation

### 1.5 Overview
This document is organized into functional requirements, non-functional requirements, system constraints, and interface requirements.

---

## 2. FUNCTIONAL REQUIREMENTS

### 2.1 User Authentication & Onboarding

#### FR-1.1: Google OAuth Sign-In
- **ID**: FR-1.1
- **Priority**: High
- **Description**: System shall allow users to authenticate using Google OAuth via Appwrite backend
- **Inputs**: User taps "Continue with Google" button
- **Processing**:
  1. System opens OAuth session with Google provider
  2. User completes Google authentication in browser
  3. System receives OAuth callback with userId and secret
  4. System creates Appwrite session
- **Outputs**: Authenticated user session, redirect to health setup
- **Preconditions**: App installed, internet connection available
- **Postconditions**: User authenticated, session stored
- **Exceptions**: 
  - Network failure → Show error message
  - OAuth cancellation → Return to sign-in screen

#### FR-1.2: Health Setup Onboarding
- **ID**: FR-1.2
- **Priority**: High
- **Description**: System shall guide users through 3-step health setup process
- **Steps**:
  1. **Step 1**: Connect Galaxy Watch - Instructions to pair watch via Bluetooth, set to "Measure every 10 minutes" (NOT continuous)
  2. **Step 2**: Grant Permissions - Request Health Connect read permission for heart rate data
  3. **Step 3**: Test Connection - Verify heart rate data can be read successfully
- **Inputs**: User progresses through steps, grants permissions
- **Outputs**: Health monitoring active, permissions granted
- **Preconditions**: User authenticated, Health Connect installed
- **Postconditions**: Health monitoring initialized

#### FR-1.3: Trip Onboarding
- **ID**: FR-1.3
- **Priority**: High
- **Description**: System shall collect trip planning information through integrated onboarding
- **Steps**:
  1. **Step 1**: Personal Information
     - Age (years)
     - Height (cm)
     - Weight (kg)
     - Gender (male/female/unspecified)
  2. **Step 2**: Trip Dates
     - Start date (calendar picker)
     - End date (calendar picker, max 5 days from start)
     - Itinerary start time (default 09:00)
  3. **Step 3**: Accommodation Location
     - Option A: Auto-detect via GPS
     - Option B: Manual city name entry
     - Option C: Map picker for precise location
  4. **Step 4**: Place Selection
     - Display AI-curated places near accommodation
     - User selects places of interest (grid interface)
     - System infers preferences from selections
  5. **Step 5**: Transportation Mode
     - Transit (public transport)
     - Driving (private vehicle)
- **Inputs**: User form inputs, location data, place selections
- **Outputs**: Trip context saved, preferences inferred, places cached
- **Preconditions**: User authenticated
- **Postconditions**: Trip configuration complete, ready for planning

### 2.2 Health Monitoring

#### FR-2.1: Health Connect Initialization
- **ID**: FR-2.1
- **Priority**: High
- **Description**: System shall initialize Health Connect SDK and verify availability
- **Processing**:
  1. Check SDK availability status
  2. Initialize Health Connect
  3. Verify device supports Health Connect (Android 14+)
- **Outputs**: Initialization status, availability message
- **Exceptions**: 
  - SDK unavailable → Show installation prompt
  - Update required → Show update prompt

#### FR-2.2: Permission Management
- **ID**: FR-2.2
- **Priority**: High
- **Description**: System shall request and verify Health Connect read permissions
- **Permissions Required**:
  - Read access to HeartRate records
- **Processing**:
  1. Request permission via Health Connect API
  2. Verify permission granted (check returned array)
  3. Test permission by attempting read
- **Outputs**: Permission status (granted/denied)
- **Exceptions**: 
  - Permission denied → Show manual grant instructions
  - SecurityException → Return false, show error

#### FR-2.3: Heart Rate Polling
- **ID**: FR-2.3
- **Priority**: High
- **Description**: System shall poll Health Connect for latest heart rate data every 5 minutes
- **Polling Strategy**:
  - Interval: 5 minutes (300 seconds)
  - Window: Last 180 minutes (3 hours) to handle sync delays
  - Auto-start on app launch
  - Pause when app backgrounded
  - Resume when app foregrounded
- **Processing**:
  1. Query Health Connect for HeartRate records in time window
  2. Sort by timestamp (newest first)
  3. Extract latest BPM value
  4. Update global state
- **Outputs**: Latest heart rate (BPM), timestamp, last updated time
- **Preconditions**: Permissions granted, Health Connect initialized
- **Postconditions**: Heart rate data available in global context

#### FR-2.4: Heart Rate Data Retrieval
- **ID**: FR-2.4
- **Priority**: High
- **Description**: System shall retrieve heart rate data using multiple strategies
- **Strategies**:
  1. Recent window (10 minutes)
  2. Hourly window (60 minutes)
  3. Extended window (180 minutes)
  4. Latest chunk (most recent batch by lastModifiedTime)
- **Processing**:
  - Query with ascending=false to get newest first
  - Handle pagination (pageSize: 200)
  - Extract samples from records
  - Sort by timestamp descending
  - Return absolute latest sample
- **Outputs**: Heart rate (BPM) or null, timestamp, source strategy
- **Exceptions**: No data found → Return null

#### FR-2.5: Manual Refresh
- **ID**: FR-2.5
- **Priority**: Medium
- **Description**: System shall provide manual refresh capability for heart rate data
- **Inputs**: User pulls down to refresh or taps refresh button
- **Processing**: Force immediate heart rate fetch
- **Outputs**: Updated heart rate data

#### FR-2.6: App State Management
- **ID**: FR-2.6
- **Priority**: Medium
- **Description**: System shall handle app foreground/background transitions
- **Processing**:
  - Monitor AppState changes
  - When app foregrounded: Refresh heart rate if monitoring active
  - When app backgrounded: Continue polling (Android allows background)
- **Outputs**: Seamless monitoring across app lifecycle

#### FR-2.7: Error Handling
- **ID**: FR-2.7
- **Priority**: High
- **Description**: System shall handle and display health monitoring errors gracefully
- **Error Types**:
  - Permission denied
  - Health Connect unavailable
  - No data available
  - API failures
- **Outputs**: User-friendly error messages with resolution steps

### 2.3 Fatigue Calculation

#### FR-3.1: Resting Energy Expenditure (REE) Calculation
- **ID**: FR-3.1
- **Priority**: High
- **Description**: System shall calculate REE using Mifflin-St Jeor equation
- **Formula (Male)**:
  ```
  REE (kcal/day) = 66.5 + (13.75 × weight_kg) + (5.003 × height_cm) − (6.775 × age)
  ```
- **Formula (Female)**:
  ```
  REE (kcal/day) = 655.1 + (9.563 × weight_kg) + (1.850 × height_cm) − (4.676 × age)
  ```
- **Inputs**: Gender, age (years), weight (kg), height (cm)
- **Outputs**: REE in kcal/day
- **Preconditions**: User profile complete

#### FR-3.2: Energy Expenditure from Heart Rate
- **ID**: FR-3.2
- **Priority**: High
- **Description**: System shall calculate current energy expenditure from heart rate using Polar RS400 formula
- **Formula (Male)**:
  ```
  EE (J/min) = −55.0969 + 0.6309 × HR + 0.1988 × weight (kg) + 0.2017 × age (yrs)
  ```
- **Formula (Female)**:
  ```
  EE (J/min) = −20.4022 + 0.4472 × HR − 0.1263 × weight (kg) + 0.074 × age (yrs)
  ```
- **Conversion**: J/min → kcal/hour (1 kcal = 4184 J, 1 hour = 60 min)
- **Baseline Adjustment**: For HR < 85 BPM, use REE/24 as minimum
- **Inputs**: Heart rate (BPM), user profile
- **Outputs**: Energy expenditure (kcal/hour)

#### FR-3.3: Daily Energy Budget Calculation
- **ID**: FR-3.3
- **Priority**: High
- **Description**: System shall calculate daily energy budget based on activity level
- **Activity Multipliers**:
  - Sedentary: 1.2
  - Light: 1.55
  - Moderate: 1.75
  - Vigorous: 2.0
- **Formula**: `Daily Budget = REE × Activity Multiplier`
- **Inputs**: REE, activity level
- **Outputs**: Daily energy budget (kcal)

#### FR-3.4: Total Energy Expenditure Estimation
- **ID**: FR-3.4
- **Priority**: High
- **Description**: System shall estimate total energy spent today
- **Estimation Method**:
  - Baseline: REE portion for hours awake
  - Activity: Current EE rate × hours awake × 0.5 (conservative)
  - Total: Baseline + Activity
- **Inputs**: Current HR, user profile, hours awake (default 8)
- **Outputs**: Total energy spent today (kcal)

#### FR-3.5: Fatigue Level Determination
- **ID**: FR-3.5
- **Priority**: High
- **Description**: System shall determine fatigue level based on energy budget percentage
- **Levels**:
  - **Rested**: < 30% budget used
  - **Light**: 30-50% budget used
  - **Moderate**: 50-70% budget used
  - **High**: 70-90% budget used
  - **Exhausted**: ≥ 90% budget used
- **Inputs**: Percentage of daily budget used
- **Outputs**: Fatigue level enum

#### FR-3.6: Fatigue Recommendations
- **ID**: FR-3.6
- **Priority**: Medium
- **Description**: System shall provide recommendations based on fatigue level
- **Recommendations**:
  - Rested: "Perfect time for exploring and activities"
  - Light: "Continue at this pace, stay hydrated"
  - Moderate: "Consider taking a short break soon. Find a café or park to rest"
  - High: "Time for a significant rest. Find a comfortable place to sit and relax for 30+ minutes"
  - Exhausted: "Stop current activities. Return to hotel or find a quiet place to rest for at least an hour"
- **Inputs**: Fatigue level
- **Outputs**: Message and recommendation string

#### FR-3.7: Fallback Calculation (No HR Data)
- **ID**: FR-3.7
- **Priority**: Medium
- **Description**: System shall calculate fatigue without heart rate data using default walking HR
- **Default**: 100 BPM (light walking)
- **Processing**: Use default HR in energy expenditure formula
- **Outputs**: Estimated fatigue data with "(estimated without HR data)" message

#### FR-3.8: Fatigue Tracking State
- **ID**: FR-3.8
- **Priority**: High
- **Description**: System shall track whether fatigue monitoring is active
- **Storage**: AsyncStorage key "isTracking"
- **Flow**:
  1. User starts tracking in Explore tab
  2. Fatigue calculation activates
  3. Fatigue data saved to AsyncStorage
  4. Displayed in Explore tab badge
  5. Detailed view in Health tab
- **Inputs**: User toggles tracking on/off
- **Outputs**: Tracking state persisted, fatigue calculated when active

### 2.4 Place Discovery & Search

#### FR-4.1: AI-Curated Place Suggestions
- **ID**: FR-4.1
- **Priority**: High
- **Description**: System shall generate AI-curated place suggestions using OpenAI GPT-4
- **Processing**:
  1. Send location (lat/lng), city name, country, trip dates to GPT-4
  2. GPT-4 generates 30 quality tourist attractions
  3. Filter by confidence threshold (≥ 0.6)
  4. Reject banned names (airports, hospitals, etc.)
  5. Reject seasonal_future entries
- **Inputs**: Coordinates, city name, country, trip window
- **Outputs**: Array of AISuggestion objects (name, category, priority, confidence)
- **Caching**: 30-minute TTL per location key

#### FR-4.2: Google Places Text Search
- **ID**: FR-4.2
- **Priority**: High
- **Description**: System shall resolve AI suggestions to Google Places via text search
- **Processing**:
  1. For each AI suggestion, perform Google Places text search
  2. Match by name similarity
  3. Filter by distance (max 60km from origin)
  4. Filter by type (reject blocklisted types)
  5. Batch process (5 at a time) for efficiency
- **Inputs**: AI suggestion names, origin coordinates
- **Outputs**: Matched Google Place objects
- **Exceptions**: No match found → Skip suggestion

#### FR-4.3: Place Details Enrichment
- **ID**: FR-4.3
- **Priority**: High
- **Description**: System shall fetch detailed information for places
- **Details Fetched**:
  - Opening hours (current_opening_hours, opening_hours)
  - UTC offset
  - Business status
  - Formatted address
- **Caching**: 21-day TTL per place_id
- **Processing**:
  1. Check cache first
  2. Fetch from Google Places Details API if not cached
  3. Store in cache
  4. Process in parallel (pool of 3)
- **Inputs**: Place IDs
- **Outputs**: Enriched place objects with hours, status

#### FR-4.4: Place Scoring & Ranking
- **ID**: FR-4.4
- **Priority**: Medium
- **Description**: System shall score and rank places for recommendation
- **Scoring Factors**:
  - Bayesian rating (rating × review volume)
  - Proximity boost (closer = higher score)
  - User preference weight
  - Icon bonus (landmarks, heritage sites)
- **Formula**: `score = bayes × volume × iconBonus × proximity × (1 + 0.8 × prefWeight)`
- **Inputs**: Place data, user preferences, origin coordinates
- **Outputs**: Scored and ranked place list

#### FR-4.5: Category Normalization
- **ID**: FR-4.5
- **Priority**: Medium
- **Description**: System shall normalize place categories for consistency
- **Mappings**:
  - place_of_worship → religious_sites
  - amusement_park → amusement_park (5-8 hour duration)
  - theme_park → theme_park (5-8 hour duration)
  - tourist_attraction → landmark (if matches pattern)
  - point_of_interest → tourist_attraction
- **Inputs**: Google Place types array
- **Outputs**: Normalized category string

#### FR-4.6: Indoor/Outdoor Classification
- **ID**: FR-4.6
- **Priority**: Medium
- **Description**: System shall classify places as indoor, outdoor, both, or unknown
- **Indoor Keywords**: museum, art_gallery, library, shopping_mall, restaurant, cafe, etc.
- **Outdoor Keywords**: park, tourist_attraction, zoo, stadium, amusement_park, beach, etc.
- **Logic**: Check place types against keyword lists
- **Inputs**: Place types array
- **Outputs**: Category enum (indoor/outdoor/both/unknown)

#### FR-4.7: Opening Hours Processing
- **ID**: FR-4.7
- **Priority**: High
- **Description**: System shall process and format opening hours
- **Processing**:
  1. Extract periods from current_opening_hours or opening_hours
  2. Find today's periods
  3. Format as "HH:MM-HH:MM" strings
  4. Calculate next open/close times
  5. Determine if open now, closing soon (within 45 min)
- **Outputs**: 
  - todaysHoursText: "09:00-17:00" or "Closed today"
  - openNow: boolean
  - closingSoon: boolean
  - willOpenAt: ISO string
  - willCloseAt: ISO string

#### FR-4.8: Photo URL Generation
- **ID**: FR-4.8
- **Priority**: Medium
- **Description**: System shall generate photo URLs from Google Places photo references
- **Format**: `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference={ref}&key={key}`
- **Inputs**: Photo reference from place object
- **Outputs**: Photo URL, attribution text

### 2.5 Itinerary Generation

#### FR-5.1: Single-Day Itinerary Generation
- **ID**: FR-5.1
- **Priority**: High
- **Description**: System shall generate single-day itineraries using OpenAI GPT-4
- **Processing**:
  1. Build compact place list (max 28 places)
  2. Load user preferences and must-see places
  3. Fetch weather forecast for date
  4. Send to GPT-4 with system prompt and user prompt
  5. Parse JSON response
  6. Validate itinerary structure
- **Constraints**:
  - Use ONLY provided places (no invention)
  - Respect opening hours
  - Prioritize must-see places
  - Weather-aware (indoor for rain)
  - No route number invention
  - Meal suggestions in reason field (not blocks)
- **Inputs**: Places list, user coordinates, date, preferences
- **Outputs**: Itinerary JSON with ordered items

#### FR-5.2: Multi-Day Itinerary Planning
- **ID**: FR-5.2
- **Priority**: High
- **Description**: System shall generate multi-day itineraries with anchor assignment
- **Processing**:
  1. Calculate trip days from start/end dates
  2. Assign anchor places (must-sees first, then top-rated)
  3. Prevent duplicate place assignments across days
  4. For each day:
     a. Fetch weather forecast
     b. Generate day itinerary with AI
     c. Optimize route
     d. Enrich with place details
  5. Combine all day plans
- **Anchor Assignment**:
  - Must-see places: One per day, round-robin
  - Top-rated places: Fill remaining days
  - Max 1 anchor per day
- **Inputs**: Trip dates, places pool, homebase, preferences
- **Outputs**: TripPlan object with DayPlan array

#### FR-5.3: Duplicate Prevention
- **ID**: FR-5.3
- **Priority**: High
- **Description**: System shall prevent duplicate place visits across days
- **Tracking**: Set of used place_ids per day
- **Processing**:
  - Track used places in previous days
  - Pass used places list to AI for each day
  - AI instructed to NOT select used places
  - Verify no duplicates in final plan
- **Inputs**: Previous day itineraries
- **Outputs**: Unique place assignments per day

#### FR-5.4: Route Optimization
- **ID**: FR-5.4
- **Priority**: High
- **Description**: System shall optimize route order to minimize travel time
- **Algorithm**: Greedy nearest-neighbor (TSP approximation)
- **Processing**:
  1. Build travel graph (all pairs travel times)
  2. Start from user coordinates
  3. Iteratively select nearest unvisited place
  4. Calculate travel times via Google Directions API
  5. Limit to 8 places to prevent API overload
- **Travel Modes**: Transit or Driving
- **Inputs**: Places list, user coordinates, transportation mode
- **Outputs**: Optimized ordered itinerary

#### FR-5.5: Travel Time Calculation
- **ID**: FR-5.5
- **Priority**: High
- **Description**: System shall calculate travel times between places
- **API**: Google Directions API
- **Modes**: Transit, Driving, Walking
- **Processing**:
  1. Call Directions API for origin → destination
  2. Extract duration from first route leg
  3. Build instructions from steps
  4. Format based on mode (transit shows vehicle type, driving shows route)
- **Outputs**: Duration (seconds), duration text, instructions
- **Exceptions**: No route found → Return Infinity, fallback estimate

#### FR-5.6: Itinerary Reconstruction
- **ID**: FR-5.6
- **Priority**: High
- **Description**: System shall reconstruct itinerary with realistic timing
- **Processing**:
  1. Start from configured start time (default 09:00)
  2. For each activity:
     a. Add travel time from previous
     b. Set start time
     c. Add activity duration
     d. Set end time
     e. Validate against opening hours
     f. Adjust if before opening or after closing
  3. Add meal suggestions for lunch/dinner windows
- **Opening Hours Validation**:
  - If start < opening: Delay to opening time
  - If end > closing: Reduce duration (min 45 min or 50% of original) or skip
- **Inputs**: Raw itinerary, user coordinates, start time
- **Outputs**: Reconstructed itinerary with times

#### FR-5.7: Meal Suggestion Integration
- **ID**: FR-5.7
- **Priority**: Medium
- **Description**: System shall suggest meals during appropriate time windows
- **Windows**:
  - Lunch: 12:00-14:00 (default 12:30)
  - Dinner: 18:00-20:00 (default 18:30)
- **Processing**:
  - Check if activity overlaps meal window
  - Add meal suggestion to activity reason field
  - Format: "💡 Lunch suggestion: Consider dining at [place] around 12:30..."
- **Inputs**: Activity times
- **Outputs**: Activities with meal suggestions

#### FR-5.8: Must-See Place Prioritization
- **ID**: FR-5.8
- **Priority**: High
- **Description**: System shall prioritize user's must-see places in itinerary
- **Processing**:
  - Extract must-see place_ids from preferences
  - Pass to AI with explicit priority instruction
  - Schedule must-sees early in day when feasible
  - Assign as anchors in multi-day planning
- **Inputs**: User preferences (mustSee array)
- **Outputs**: Itinerary with must-sees prioritized

### 2.6 Weather Integration

#### FR-6.1: Current Weather Fetch
- **ID**: FR-6.1
- **Priority**: Medium
- **Description**: System shall fetch current weather conditions
- **API**: OpenWeather Current Weather API
- **Processing**:
  1. Call API with coordinates
  2. Extract condition, temperature, humidity, wind speed
  3. Cache for 1 hour
- **Inputs**: Latitude, longitude
- **Outputs**: WeatherData object

#### FR-6.2: Weather Forecast Fetch
- **ID**: FR-6.2
- **Priority**: High
- **Description**: System shall fetch weather forecast for specific dates
- **API**: OpenWeather 5-Day Forecast API
- **Processing**:
  1. Calculate days difference (max 5 days)
  2. Fetch forecast
  3. Find forecast closest to noon on target date
  4. Extract condition
- **Inputs**: Coordinates, target date (ISO string)
- **Outputs**: WeatherData or null (assume sunny if unavailable)

#### FR-6.3: Weather-Aware Itinerary Adaptation
- **ID**: FR-6.3
- **Priority**: High
- **Description**: System shall adapt itineraries based on weather conditions
- **Bad Weather Conditions**: Rain, Drizzle, Thunderstorm, Heavy Rain, Snow, Blizzard, Hail
- **Processing**:
  - If rain/storm forecast: Prioritize indoor activities
  - If sunny: Include both indoor and outdoor
  - Pass weather context to AI during generation
- **Inputs**: Weather forecast, itinerary places
- **Outputs**: Weather-adapted itinerary

#### FR-6.4: Indoor Alternative Finding
- **ID**: FR-6.4
- **Priority**: Medium
- **Description**: System shall find indoor alternatives for outdoor activities when weather is bad
- **Processing**:
  1. Identify outdoor activities in itinerary
  2. Search nearby places
  3. Filter for indoor places with good ratings (≥ 3.5)
  4. Score by relevance and rating
  5. Return top 3 alternatives
- **Inputs**: Outdoor activity, user location, max distance (5km)
- **Outputs**: Array of indoor alternative places

### 2.7 Schedule Tracking

#### FR-7.1: Tracking State Management
- **ID**: FR-7.1
- **Priority**: High
- **Description**: System shall manage itinerary tracking state
- **Storage**: AsyncStorage key "isTracking"
- **Operations**:
  - Start tracking: Set to true
  - Stop tracking: Set to false
  - Check state: Read from storage
- **Inputs**: User toggles tracking
- **Outputs**: Tracking state persisted

#### FR-7.2: Schedule Status Calculation
- **ID**: FR-7.2
- **Priority**: High
- **Description**: System shall calculate if user is behind schedule
- **Processing**:
  1. Get current activity from itinerary
  2. Compare current time to activity end time
  3. Calculate delay in minutes
  4. Determine if behind (delay > 10 minutes)
- **Inputs**: Itinerary, current activity index, current time
- **Outputs**: ScheduleStatus (isOnTime, isBehindSchedule, delayMinutes)

#### FR-7.3: Schedule Adjustment Generation
- **ID**: FR-7.3
- **Priority**: High
- **Description**: System shall generate intelligent schedule adjustments when behind
- **Adjustment Types**:
  1. **Extend Current**: Add delay to current activity end time
  2. **Skip Next**: Remove next activity from itinerary
  3. **Replace Next**: Find shorter alternative for next activity
  4. **Reschedule Remaining**: Recalculate all remaining activity times
- **Processing**:
  - Only generate if delay > 10 minutes
  - Calculate time saved for each option
  - Provide impact description
- **Inputs**: Itinerary, schedule status, user location
- **Outputs**: Array of ScheduleAdjustment objects

#### FR-7.4: Location-Based Tracking
- **ID**: FR-7.4
- **Priority**: Medium
- **Description**: System shall track user location when tracking is active
- **Processing**:
  1. Request location permissions
  2. Monitor location every 30 seconds when tracking
  3. Check if user is at activity location (100m threshold)
  4. Update current activity index
- **Inputs**: Location permissions, tracking state
- **Outputs**: User location, activity proximity status

### 2.8 User Preferences

#### FR-8.1: Preference Storage
- **ID**: FR-8.1
- **Priority**: High
- **Description**: System shall store user preferences persistently
- **Storage**: AsyncStorage key "userPreferences"
- **Data Structure**:
  - Biometrics: age, height, weight, sex
  - Preferences: Record<category, {weight: 1-10, duration: 30-360}>
  - mustSee: string[] (place_ids)
  - avoidPlaces: string[]
- **Inputs**: User preferences object
- **Outputs**: Preferences saved to storage

#### FR-8.2: Preference Inference
- **ID**: FR-8.2
- **Priority**: High
- **Description**: System shall infer preferences from user's place selections
- **Processing**:
  1. Count selections by category
  2. Calculate selection ratio per category
  3. Map ratio to weight (1-10):
     - ≥50%: 8-10 (high)
     - 30-50%: 6-8 (medium-high)
     - 20-30%: 4-6 (medium)
     - <20%: 2-4 (low)
  4. Calculate average duration per category
  5. Add complementary categories
- **Inputs**: Selected places array
- **Outputs**: Inferred preferences object

#### FR-8.3: Avoid List Management
- **ID**: FR-8.3
- **Priority**: Medium
- **Description**: System shall manage list of places to avoid
- **Operations**:
  - Add to avoid list
  - Remove from avoid list
  - Check if place is in avoid list
- **Inputs**: Place name or place_id
- **Outputs**: Updated avoid list

### 2.9 Data Caching

#### FR-9.1: Place Details Caching
- **ID**: FR-9.1
- **Priority**: Medium
- **Description**: System shall cache place details to reduce API calls
- **TTL**: 21 days
- **Storage**: AsyncStorage with prefix "details:"
- **Processing**:
  1. Check cache before API call
  2. Store result after API call
  3. Validate cache version
- **Inputs**: Place ID
- **Outputs**: Cached details or null

#### FR-9.2: AI Shortlist Caching
- **ID**: FR-9.2
- **Priority**: Medium
- **Description**: System shall cache AI-generated shortlists
- **TTL**: 30 minutes
- **Key**: lat|lng|city|startDate|endDate
- **Storage**: In-memory Map
- **Processing**: Check cache before AI call, store after

### 2.10 User Interface

#### FR-10.1: Sign-In Screen
- **ID**: FR-10.1
- **Priority**: High
- **Description**: System shall display sign-in screen with Google OAuth button
- **Elements**:
  - TripTune logo/title
  - Tagline: "YOUR TRIP TUNED TO YOUR ENERGY"
  - "Continue with Google" button with Google icon
- **Inputs**: User tap on button
- **Outputs**: OAuth flow initiated

#### FR-10.2: Onboarding Screen
- **ID**: FR-10.2
- **Priority**: High
- **Description**: System shall display integrated onboarding flow
- **Steps**:
  1. Personal info form
  2. Date picker (calendar range)
  3. Location picker (GPS/map/city)
  4. Place selection grid
  5. Transportation mode selector
- **Navigation**: Step-by-step progression
- **Inputs**: Form inputs, selections
- **Outputs**: Trip configuration saved

#### FR-10.3: Explore Screen
- **ID**: FR-10.3
- **Priority**: High
- **Description**: System shall display itinerary planning and tracking interface
- **Features**:
  - Generate itinerary button
  - Itinerary timeline view
  - Map view with route
  - Start/Stop tracking button
  - Fatigue badge (when tracking)
  - Schedule status indicators
  - Weather alerts
- **Inputs**: User interactions
- **Outputs**: Itinerary displayed, tracking state updated

#### FR-10.4: Health/Fatigue Screen
- **ID**: FR-10.4
- **Priority**: High
- **Description**: System shall display health monitoring and fatigue information
- **Elements**:
  - Large BPM display
  - Last measurement timestamp
  - Fatigue level card (when tracking)
  - Energy stats panel
  - Recommendations
  - Pull-to-refresh
- **Inputs**: Heart rate data, tracking state
- **Outputs**: Health information displayed

#### FR-10.5: Profile Screen
- **ID**: FR-10.5
- **Priority**: Low
- **Description**: System shall display user profile information
- **Elements**: User name, email, avatar (if available)

---

## 3. NON-FUNCTIONAL REQUIREMENTS

### 3.1 Performance

#### NFR-1.1: Heart Rate Polling Frequency
- **ID**: NFR-1.1
- **Priority**: High
- **Description**: System shall poll Health Connect every 5 minutes (not more frequently)
- **Rationale**: Balance between data freshness and battery efficiency
- **Measurement**: Poll interval = 300 seconds

#### NFR-1.2: Itinerary Generation Time
- **ID**: NFR-1.2
- **Priority**: High
- **Description**: 
  - Single-day itinerary: ≤ 30 seconds
  - Multi-day itinerary: ≤ 2 minutes per day
- **Measurement**: Time from generation start to completion

#### NFR-1.3: Place Search Response Time
- **ID**: NFR-1.3
- **Priority**: Medium
- **Description**: Place search results shall load within 3 seconds
- **Measurement**: Time from search initiation to results display

#### NFR-1.4: API Response Caching
- **ID**: NFR-1.4
- **Priority**: Medium
- **Description**: System shall cache API responses to reduce latency
- **Caches**:
  - Place details: 21 days
  - AI shortlist: 30 minutes
  - Weather: 1 hour

### 3.2 Reliability

#### NFR-2.1: Health Connect Error Handling
- **ID**: NFR-2.1
- **Priority**: High
- **Description**: System shall handle Health Connect API failures gracefully
- **Scenarios**:
  - Permission denied → Show instructions
  - SDK unavailable → Show installation prompt
  - No data available → Show helpful message
  - API errors → Log and show user-friendly error

#### NFR-2.2: Google Places API Error Handling
- **ID**: NFR-2.2
- **Priority**: High
- **Description**: System shall handle Google Places API failures with fallback
- **Fallbacks**:
  - Rate limit → Retry with backoff
  - Network error → Show retry option
  - Invalid response → Use cached data if available

#### NFR-2.3: OpenAI API Error Handling
- **ID**: NFR-2.3
- **Priority**: High
- **Description**: System shall handle OpenAI API failures with error messages
- **Scenarios**:
  - Rate limit → Show "Please try again later"
  - Invalid response → Show "Generation failed, please retry"
  - Network error → Show retry option

#### NFR-2.4: Data Persistence
- **ID**: NFR-2.4
- **Priority**: High
- **Description**: System shall persist user data locally using AsyncStorage
- **Data Persisted**:
  - User preferences
  - Trip context
  - Cached places
  - Tracking state
  - Fatigue data

### 3.3 Usability

#### NFR-3.1: Design System Consistency
- **ID**: NFR-3.1
- **Priority**: Medium
- **Description**: UI shall follow consistent design system
- **Elements**:
  - Font: Rubik family (Regular, Medium, SemiBold, Bold, ExtraBold, Light)
  - Colors: Primary blue (#0061ff), consistent palette
  - Spacing: Consistent padding/margins
  - Components: Reusable UI components

#### NFR-3.2: Error Message Clarity
- **ID**: NFR-3.2
- **Priority**: High
- **Description**: System shall provide clear, actionable error messages
- **Requirements**:
  - Plain language (no technical jargon)
  - Actionable steps to resolve
  - Contextual help when available

#### NFR-3.3: Loading States
- **ID**: NFR-3.3
- **Priority**: Medium
- **Description**: System shall display loading states during async operations
- **Indicators**:
  - Activity indicators for API calls
  - Progress bars for multi-step operations
  - Skeleton screens for content loading

#### NFR-3.4: Pull-to-Refresh
- **ID**: NFR-3.4
- **Priority**: Medium
- **Description**: System shall support pull-to-refresh for manual updates
- **Screens**: Health tab, Explore tab

### 3.4 Security

#### NFR-4.1: API Key Security
- **ID**: NFR-4.1
- **Priority**: High
- **Description**: System shall securely store API keys in environment variables
- **Storage**: .env.local file (not committed to git)
- **Keys**:
  - EXPO_PUBLIC_OPENAI_API_KEY
  - EXPO_PUBLIC_GOOGLE_API_KEY
  - EXPO_PUBLIC_OPENWEATHER_KEY
  - EXPO_PUBLIC_APPWRITE_ENDPOINT
  - EXPO_PUBLIC_APPWRITE_PROJECT_ID

#### NFR-4.2: Permission Minimization
- **ID**: NFR-4.2
- **Priority**: High
- **Description**: System shall request minimal required permissions
- **Permissions**:
  - Health Connect: Read HeartRate only
  - Location: Foreground only (when tracking)
  - No unnecessary permissions

#### NFR-4.3: OAuth Token Security
- **ID**: NFR-4.3
- **Priority**: High
- **Description**: System shall handle OAuth tokens securely via Appwrite
- **Storage**: Appwrite session management (not local storage)

### 3.5 Compatibility

#### NFR-5.1: Android Platform Support
- **ID**: NFR-5.1
- **Priority**: High
- **Description**: System shall support Android devices (primary platform)
- **Requirements**:
  - Android SDK 26+ (Android 8.0+)
  - Health Connect support (Android 14+ recommended)

#### NFR-5.2: Health Connect Integration
- **ID**: NFR-5.2
- **Priority**: High
- **Description**: System shall integrate with Health Connect (Android 14+)
- **Requirements**:
  - Health Connect app installed
  - SDK available
  - Permissions granted

#### NFR-5.3: Galaxy Watch Compatibility
- **ID**: NFR-5.3
- **Priority**: Medium
- **Description**: System shall work with Galaxy Watch via Samsung Health
- **Requirements**:
  - Watch paired via Bluetooth
  - Samsung Health installed
  - Heart rate measurement set to "every 10 minutes" (NOT continuous)
  - Samsung Health syncs to Health Connect

#### NFR-5.4: iOS Compatibility (Future)
- **ID**: NFR-5.4
- **Priority**: Low
- **Description**: System may support iOS in future (not current requirement)
- **Note**: Current implementation is Android-only

### 3.6 Maintainability

#### NFR-6.1: Code Organization
- **ID**: NFR-6.1
- **Priority**: Medium
- **Description**: Code shall be organized into logical modules
- **Structure**:
  - `lib/`: Domain logic and integrations
  - `app/`: UI screens and navigation
  - `components/`: Reusable UI components
  - `contexts/`: Global state management
  - `hooks/`: Custom React hooks
  - `constants/`: Constants and configuration

#### NFR-6.2: Logging
- **ID**: NFR-6.2
- **Priority**: Medium
- **Description**: System shall include comprehensive logging for debugging
- **Log Levels**: Console.log for development, structured logging
- **Areas**: Health monitoring, API calls, itinerary generation, errors

### 3.7 Scalability

#### NFR-7.1: API Rate Limiting
- **ID**: NFR-7.1
- **Priority**: Medium
- **Description**: System shall handle API rate limits gracefully
- **Strategies**:
  - Caching to reduce calls
  - Batching where possible
  - Retry with backoff
  - User-friendly error messages

---

## 4. SYSTEM CONSTRAINTS

### 4.1 Technical Constraints

#### SC-1.1: Platform Dependency
- **Description**: Application requires Android platform with Health Connect
- **Impact**: iOS support not available in current version

#### SC-1.2: External Service Dependencies
- **Description**: Application depends on multiple external services
- **Services**:
  - Health Connect (Android system service)
  - Google Places API
  - Google Directions API
  - OpenAI GPT-4 API
  - OpenWeather API
  - Appwrite (authentication)
- **Impact**: Service outages affect functionality

#### SC-1.3: Network Requirement
- **Description**: Most features require internet connection
- **Impact**: Limited offline functionality

#### SC-1.4: Wearable Device Requirement
- **Description**: Heart rate monitoring requires Galaxy Watch or compatible device
- **Impact**: Fatigue features limited without wearable

### 4.2 Business Constraints

#### SC-2.1: API Costs
- **Description**: External APIs have usage costs
- **Impact**: Need to monitor and optimize API usage

#### SC-2.2: Development Build Required
- **Description**: Application requires development build (not Expo Go)
- **Impact**: Testing requires custom build process

---

## 5. INTERFACE REQUIREMENTS

### 5.1 User Interfaces

#### UI-1.1: Sign-In Screen
- **Layout**: Centered content, Google OAuth button
- **Responsiveness**: Adapts to screen size
- **Accessibility**: Button labels, readable text

#### UI-1.2: Onboarding Flow
- **Layout**: Step-by-step wizard
- **Navigation**: Next/Back buttons, progress indicator
- **Input Validation**: Real-time validation feedback

#### UI-1.3: Explore Screen
- **Layout**: Tab-based navigation, timeline view, map view toggle
- **Interactions**: Tap to expand, swipe to navigate, pull-to-refresh
- **Visualizations**: Timeline, map with route, fatigue badge

#### UI-1.4: Health Screen
- **Layout**: Large BPM display, cards for information
- **Updates**: Real-time updates, pull-to-refresh
- **Visualizations**: Fatigue level with color coding

### 5.2 External Interfaces

#### EI-1.1: Health Connect API
- **Protocol**: Android Health Connect SDK
- **Data Format**: Health Connect record types (HeartRate)
- **Authentication**: Android system permissions

#### EI-1.2: Google Places API
- **Protocol**: REST API over HTTPS
- **Data Format**: JSON
- **Authentication**: API key in request

#### EI-1.3: Google Directions API
- **Protocol**: REST API over HTTPS
- **Data Format**: JSON
- **Authentication**: API key in request

#### EI-1.4: OpenAI GPT-4 API
- **Protocol**: REST API over HTTPS
- **Data Format**: JSON (Chat Completions)
- **Authentication**: API key in header

#### EI-1.5: OpenWeather API
- **Protocol**: REST API over HTTPS
- **Data Format**: JSON
- **Authentication**: API key in request

#### EI-1.6: Appwrite API
- **Protocol**: REST API over HTTPS
- **Data Format**: JSON
- **Authentication**: OAuth tokens

---

## 6. SYSTEM MODELS

### 6.1 Data Models

#### DM-1.1: UserProfile
```typescript
{
  age: number;           // years
  heightCm: number;      // centimeters
  weightKg: number;      // kilograms
  sex?: "male" | "female" | "unspecified";
}
```

#### DM-1.2: UserPreferences
```typescript
{
  age?: number;
  height?: number;
  weight?: number;
  preferences: Record<string, CategoryPref>;
  mustSee: string[];           // place_ids
  avoidPlaces: string[];       // place_ids or names
}
```

#### DM-1.3: Place
```typescript
{
  place_id: string;
  name: string;
  lat: number;
  lng: number;
  category: "indoor" | "outdoor" | "both" | "unknown";
  normalizedCategory: string;
  rating: number;
  user_ratings_total: number;
  preferredDuration: number;   // minutes
  score: number;
  openNow?: boolean;
  closingSoon?: boolean;
  todaysHoursText?: string;
  willOpenAt?: string;
  willCloseAt?: string;
  photoUrl?: string;
  // ... additional fields
}
```

#### DM-1.4: ItineraryItem
```typescript
{
  order: number;
  place_id: string | null;
  name: string;
  category: string;
  lat: number;
  lng: number;
  start_time: string;          // "HH:MM"
  end_time: string;            // "HH:MM"
  estimated_duration: number;   // minutes
  travel_time_minutes: number;
  travel_instructions?: string;
  reason?: string;
  coordinates?: { lat: number; lng: number };
}
```

#### DM-1.5: DayPlan
```typescript
{
  date: string;                // "YYYY-MM-DD"
  anchorIds: string[];         // place_ids
  itinerary: ItinItem[];
  pool?: any[];                // available places
}
```

#### DM-1.6: TripPlan
```typescript
{
  startDate: string;           // "YYYY-MM-DD"
  endDate: string;             // "YYYY-MM-DD"
  homebase: { lat: number; lng: number };
  days: DayPlan[];
}
```

#### DM-1.7: FatigueData
```typescript
{
  level: FatigueLevel;         // Rested | Light | Moderate | High | Exhausted
  percentage: number;          // 0-100
  currentEE: number;           // kcal/hour
  dailyREE: number;            // kcal/day
  totalEEToday: number;        // kcal
  budgetRemaining: number;     // kcal
  message: string;
  recommendation: string;
}
```

#### DM-1.8: HeartRateData
```typescript
{
  bpm: number | null;
  timestamp: string | undefined;
  lastUpdated: Date | null;
}
```

#### DM-1.9: WeatherData
```typescript
{
  condition: string;           // "Clear", "Rain", etc.
  temperature: number;         // Celsius
  humidity: number;            // percentage
  windSpeed: number;           // m/s
  description: string;
  icon: string;
  timestamp: string;
}
```

#### DM-1.10: ScheduleStatus
```typescript
{
  currentActivityIndex: number;
  isOnTime: boolean;
  isBehindSchedule: boolean;
  delayMinutes: number;
  nextActivityStart: string;
  currentActivityEnd: string;
  estimatedArrival: string;
}
```

### 6.2 State Models

#### SM-1.1: Global Application State
- **Authentication State**: isLoggedIn, user, loading
- **Heart Rate State**: heartRate, isMonitoring, error
- **Trip Context**: startDate, endDate, homebase, days
- **Tracking State**: isTracking (AsyncStorage)

---

## 7. APPENDIX

### 7.1 Glossary
- **Anchor Place**: A must-see or high-priority place assigned to a specific day in multi-day planning
- **Energy Budget**: Total daily energy available based on REE and activity level
- **Fatigue Level**: Categorical representation of energy depletion (Rested to Exhausted)
- **Health Connect**: Android's unified health data platform
- **Itinerary Reconstruction**: Process of adding realistic timing to AI-generated itinerary
- **Must-See Place**: User-selected place that must be included in itinerary
- **Place Pool**: Collection of available places for itinerary generation
- **Route Optimization**: Process of ordering places to minimize travel time
- **Travel Graph**: Graph structure representing travel times between all place pairs

### 7.2 Assumptions
1. Users have Android devices with Health Connect support
2. Users have Galaxy Watch or compatible wearable device
3. Users have internet connection for most features
4. Users grant required permissions
5. External APIs are available and responsive
6. Users understand basic app navigation

### 7.3 Dependencies
- React Native 0.79.5
- Expo SDK ~53.0.17
- Health Connect SDK (Android)
- Google Places API
- Google Directions API
- OpenAI GPT-4 API
- OpenWeather API
- Appwrite (authentication)

---

## Document Control

**Version History**:
- v1.0.0 (2025-01-27): Initial comprehensive requirements document

**Approval**:
- Prepared by: AI Assistant
- Reviewed by: [Pending]
- Approved by: [Pending]

---

**END OF DOCUMENT**

