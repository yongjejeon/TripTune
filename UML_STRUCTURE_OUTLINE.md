# TripTune UML Structure - Complete Outline

## Overview
This document outlines the comprehensive UML structure for TripTune, including Requirements, Use Cases, Test Cases, and Class Diagrams with Mermaid charts.

---

## 1. REQUIREMENTS

### 1.1 Functional Requirements

#### FR1: User Authentication & Onboarding
- **FR1.1**: System shall allow users to sign in with Google OAuth
- **FR1.2**: System shall guide users through health setup (3-step onboarding)
- **FR1.3**: System shall request Health Connect permissions for heart rate access
- **FR1.4**: System shall validate Galaxy Watch connection and heart rate data availability

#### FR2: Health Monitoring
- **FR2.1**: System shall poll Health Connect every 5 minutes for heart rate data
- **FR2.2**: System shall display current heart rate (BPM) with timestamp
- **FR2.3**: System shall handle app foreground/background state transitions
- **FR2.4**: System shall provide manual refresh capability for heart rate data
- **FR2.5**: System shall show error messages when health data is unavailable

#### FR3: Fatigue Calculation
- **FR3.1**: System shall calculate Resting Energy Expenditure (REE) using Mifflin-St Jeor equation
- **FR3.2**: System shall calculate current energy expenditure from heart rate using Polar RS400 formula
- **FR3.3**: System shall determine fatigue level (Rested, Light, Moderate, High, Exhausted) based on energy budget
- **FR3.4**: System shall track total energy expenditure throughout the day
- **FR3.5**: System shall provide fatigue recommendations based on current level
- **FR3.6**: System shall support fatigue calculation without heart rate data (fallback mode)

#### FR4: Trip Planning - Onboarding
- **FR4.1**: System shall collect user personal information (age, height, weight, gender)
- **FR4.2**: System shall allow users to select trip dates (start and end date)
- **FR4.3**: System shall allow users to set accommodation location (GPS coordinates or city name)
- **FR4.4**: System shall allow users to select places of interest from search results
- **FR4.5**: System shall infer user preferences from selected places
- **FR4.6**: System shall store user preferences and trip configuration

#### FR5: Itinerary Generation
- **FR5.1**: System shall generate single-day itineraries using AI (OpenAI GPT)
- **FR5.2**: System shall generate multi-day itineraries with anchor place assignment
- **FR5.3**: System shall avoid duplicate place visits across days
- **FR5.4**: System shall respect opening hours when scheduling places
- **FR5.5**: System shall optimize route order to minimize travel time
- **FR5.6**: System shall insert meal breaks (lunch, dinner) at appropriate times
- **FR5.7**: System shall prioritize must-see places in itinerary generation

#### FR6: Weather Integration
- **FR6.1**: System shall fetch weather forecasts for trip dates
- **FR6.2**: System shall adapt itineraries based on weather conditions
- **FR6.3**: System shall prioritize indoor activities during rain/storm forecasts
- **FR6.4**: System shall maintain outdoor activities when weather is favorable

#### FR7: Schedule Tracking
- **FR7.1**: System shall allow users to start/stop itinerary tracking
- **FR7.2**: System shall detect when user is behind schedule
- **FR7.3**: System shall propose schedule adjustments when delays occur
- **FR7.4**: System shall display current itinerary progress

#### FR8: Place Search & Discovery
- **FR8.1**: System shall search places using Google Places API
- **FR8.2**: System shall fetch place details (photos, ratings, hours, reviews)
- **FR8.3**: System shall filter places by category and preferences
- **FR8.4**: System shall display places on map with location picker

#### FR9: Route Optimization
- **FR9.1**: System shall construct travel graph between places
- **FR9.2**: System shall calculate travel times between locations
- **FR9.3**: System shall optimize route order to minimize total travel time
- **FR9.4**: System shall provide travel instructions (walk, taxi, bus/metro)

### 1.2 Non-Functional Requirements

#### NFR1: Performance
- **NFR1.1**: Heart rate polling shall occur every 5 minutes (not more frequently)
- **NFR1.2**: Itinerary generation shall complete within 30 seconds for single-day trips
- **NFR1.3**: Itinerary generation shall complete within 2 minutes for multi-day trips
- **NFR1.4**: Place search results shall load within 3 seconds

#### NFR2: Reliability
- **NFR2.1**: System shall handle Health Connect API failures gracefully
- **NFR2.2**: System shall handle Google Places API failures with fallback
- **NFR2.3**: System shall handle OpenAI API failures with error messages
- **NFR2.4**: System shall persist user data locally using AsyncStorage

#### NFR3: Usability
- **NFR3.1**: UI shall follow consistent design system (Rubik font, color scheme)
- **NFR3.2**: System shall provide clear error messages and guidance
- **NFR3.3**: System shall support pull-to-refresh for manual updates
- **NFR3.4**: System shall display loading states during async operations

#### NFR4: Security
- **NFR4.1**: System shall securely store API keys in environment variables
- **NFR4.2**: System shall request minimal required permissions
- **NFR4.3**: System shall handle OAuth tokens securely

#### NFR5: Compatibility
- **NFR5.1**: System shall support Android devices (primary platform)
- **NFR5.2**: System shall integrate with Health Connect (Android 14+)
- **NFR5.3**: System shall work with Galaxy Watch via Samsung Health

---

## 2. USE CASES

### 2.1 Actors
- **User**: Primary actor - end user of the TripTune application
- **System**: TripTune application itself
- **Health Connect**: External service for health data
- **Google Places API**: External service for place data
- **OpenAI API**: External service for AI itinerary generation
- **OpenWeather API**: External service for weather data
- **Samsung Health**: External service that syncs with Health Connect

### 2.2 Use Case Diagram Structure

#### UC1: Sign In and Onboard
- **Actor**: User
- **Precondition**: User has installed TripTune app
- **Main Flow**:
  1. User opens app
  2. System displays sign-in screen
  3. User taps "Continue with Google"
  4. System routes to health setup
  5. User completes 3-step health onboarding
  6. System requests Health Connect permissions
  7. User grants permissions
  8. System validates connection
  9. User lands on home screen
- **Postcondition**: User is authenticated and health monitoring is active

#### UC2: Monitor Heart Rate
- **Actor**: System, Health Connect
- **Precondition**: Health Connect permissions granted, Galaxy Watch connected
- **Main Flow**:
  1. System starts monitoring on app launch
  2. System polls Health Connect every 5 minutes
  3. Health Connect returns latest heart rate data
  4. System updates global state
  5. System displays heart rate in Health tab
- **Postcondition**: Current heart rate is available throughout app

#### UC3: Calculate Fatigue
- **Actor**: System
- **Precondition**: Heart rate data available, user profile exists, tracking is active
- **Main Flow**:
  1. System retrieves current heart rate
  2. System retrieves user profile (age, weight, height, gender)
  3. System calculates REE using Mifflin-St Jeor equation
  4. System calculates current energy expenditure from HR
  5. System estimates total energy spent today
  6. System calculates percentage of daily budget used
  7. System determines fatigue level
  8. System generates recommendation message
  9. System displays fatigue information
- **Postcondition**: Fatigue level and recommendations are displayed

#### UC4: Plan Single-Day Itinerary
- **Actor**: User, System, OpenAI API, Google Places API
- **Precondition**: User has selected places, dates, and accommodation
- **Main Flow**:
  1. User navigates to Explore tab
  2. User taps "Generate Itinerary"
  3. System retrieves selected places
  4. System retrieves user preferences
  5. System fetches weather forecast
  6. System calls OpenAI API with places and preferences
  7. OpenAI generates optimized itinerary
  8. System parses and validates itinerary JSON
  9. System optimizes route order
  10. System displays itinerary to user
- **Postcondition**: User has a complete single-day itinerary

#### UC5: Plan Multi-Day Itinerary
- **Actor**: User, System, OpenAI API, Google Places API, OpenWeather API
- **Precondition**: User has selected places, trip dates, and accommodation
- **Main Flow**:
  1. User navigates to Explore tab
  2. User selects multi-day option
  3. System calculates trip days
  4. System assigns anchor places to each day
  5. System prevents duplicate place assignments
  6. For each day:
     a. System fetches weather forecast
     b. System generates day itinerary with AI
     c. System optimizes route
     d. System enriches with place details
  7. System combines all day plans
  8. System displays complete multi-day itinerary
- **Postcondition**: User has a complete multi-day itinerary

#### UC6: Track Itinerary Progress
- **Actor**: User, System
- **Precondition**: Itinerary generated, user has started tracking
- **Main Flow**:
  1. User taps "Start Tracking" in Explore tab
  2. System marks tracking as active
  3. System monitors current time vs. planned schedule
  4. System detects if user is behind schedule
  5. System calculates time pressure
  6. System proposes adjustments if needed
  7. System updates fatigue calculation based on activity
  8. User can stop tracking at any time
- **Postcondition**: System tracks user progress and provides feedback

#### UC7: Search Places
- **Actor**: User, System, Google Places API
- **Precondition**: User is on onboarding or explore screen
- **Main Flow**:
  1. User enters search query or selects location
  2. System calls Google Places API
  3. Google Places returns matching places
  4. System enriches results with photos and details
  5. System displays places in list
  6. User can select places to add to trip
- **Postcondition**: User has selected places for itinerary

#### UC8: Adapt to Weather
- **Actor**: System, OpenWeather API
- **Precondition**: Itinerary exists, weather API available
- **Main Flow**:
  1. System fetches weather forecast for trip dates
  2. System identifies rain/storm conditions
  3. System prioritizes indoor activities for bad weather days
  4. System maintains outdoor activities for good weather
  5. System regenerates affected day itineraries if needed
- **Postcondition**: Itinerary is weather-appropriate

---

## 3. TEST CASES

### 3.1 Unit Test Cases

#### TC-UT-1: Fatigue Calculator - REE Calculation
- **Test**: Calculate REE for male user (age 30, weight 75kg, height 180cm)
- **Expected**: REE = 66.5 + (13.75 × 75) + (5.003 × 180) − (6.775 × 30) = 1847.29 kcal/day
- **Status**: To be implemented

#### TC-UT-2: Fatigue Calculator - Energy Expenditure from HR
- **Test**: Calculate energy expenditure for female (HR 85 BPM, age 25, weight 60kg)
- **Expected**: EE calculated using female formula, converted to kcal/hour
- **Status**: To be implemented

#### TC-UT-3: Fatigue Calculator - Fatigue Level Determination
- **Test**: Determine fatigue level for 45% energy budget used
- **Expected**: FatigueLevel.LIGHT
- **Status**: To be implemented

#### TC-UT-4: Route Optimizer - Travel Graph Construction
- **Test**: Build travel graph for 5 places
- **Expected**: Graph with edges between all places, weights as travel times
- **Status**: To be implemented

#### TC-UT-5: Itinerary Optimizer - Meal Insertion
- **Test**: Insert lunch and dinner into 8-hour itinerary
- **Expected**: Lunch at ~12:00-13:30, Dinner at ~18:00-19:30
- **Status**: To be implemented

### 3.2 Integration Test Cases

#### TC-IT-1: Health Connect Integration
- **Test**: Poll Health Connect and retrieve heart rate
- **Precondition**: Health Connect permissions granted, watch connected
- **Steps**:
  1. Call ensureHCReady()
  2. Call readLatestBpmFast()
  3. Verify heart rate data returned
- **Expected**: Valid BPM value with timestamp
- **Status**: To be implemented

#### TC-IT-2: Google Places API Integration
- **Test**: Search for places near coordinates
- **Steps**:
  1. Call fetchPlacesByCoordinates()
  2. Verify API response
  3. Verify place enrichment (photos, hours)
- **Expected**: Array of places with required fields
- **Status**: To be implemented

#### TC-IT-3: OpenAI Itinerary Generation
- **Test**: Generate single-day itinerary
- **Steps**:
  1. Prepare places list
  2. Call generateItinerary()
  3. Verify JSON response parsing
  4. Verify itinerary structure
- **Expected**: Valid itinerary with ordered items
- **Status**: To be implemented

#### TC-IT-4: Multi-Day Planner Flow
- **Test**: Generate 3-day itinerary
- **Steps**:
  1. Set trip dates (3 days)
  2. Select 15 places
  3. Call generateMultiDayPlan()
  4. Verify anchor assignment
  5. Verify no duplicates
  6. Verify all days have itineraries
- **Expected**: Complete 3-day plan with unique places
- **Status**: To be implemented

#### TC-IT-5: Weather-Aware Adaptation
- **Test**: Adapt itinerary for rainy day
- **Steps**:
  1. Fetch weather forecast (rain expected)
  2. Generate itinerary with weather context
  3. Verify indoor activities prioritized
- **Expected**: Itinerary focuses on indoor places
- **Status**: To be implemented

### 3.3 System Test Cases

#### TC-ST-1: End-to-End Trip Planning
- **Test**: Complete user journey from sign-in to itinerary
- **Steps**:
  1. Sign in with Google
  2. Complete health setup
  3. Enter trip dates
  4. Set accommodation
  5. Search and select places
  6. Generate multi-day itinerary
  7. Start tracking
  8. Verify fatigue calculation
- **Expected**: Complete flow works without errors
- **Status**: To be implemented

#### TC-ST-2: Heart Rate Monitoring Lifecycle
- **Test**: Monitor heart rate through app lifecycle
- **Steps**:
  1. Start app (monitoring auto-starts)
  2. Verify heart rate appears
  3. Put app in background
  4. Bring app to foreground
  5. Verify monitoring resumes
  6. Stop monitoring
  7. Verify monitoring stops
- **Expected**: Monitoring handles state transitions correctly
- **Status**: To be implemented

#### TC-ST-3: Schedule Tracking with Fatigue
- **Test**: Track itinerary and calculate fatigue
- **Steps**:
  1. Generate itinerary
  2. Start tracking
  3. Simulate time progression
  4. Verify schedule status updates
  5. Verify fatigue updates
  6. Verify recommendations change
- **Expected**: Real-time updates reflect current state
- **Status**: To be implemented

#### TC-ST-4: Error Handling
- **Test**: Handle API failures gracefully
- **Steps**:
  1. Disable network
  2. Attempt place search
  3. Attempt itinerary generation
  4. Verify error messages displayed
  5. Re-enable network
  6. Verify recovery
- **Expected**: Errors handled, user informed, recovery works
- **Status**: To be implemented

---

## 4. CLASS DIAGRAMS

### 4.1 Core Domain Classes
- UserProfile
- Place
- Itinerary
- ItineraryItem
- DayPlan
- TripPlan
- FatigueData
- HeartRateData

### 4.2 Service Classes
- HealthService (health.ts)
- FatigueCalculator (fatigueCalculator.ts)
- ItineraryAI (itineraryAI.ts)
- MultiDayPlanner (multidayPlanner.ts)
- ItineraryOptimizer (itineraryOptimizer.ts)
- RouteOptimizer (routeOptimizer.ts)
- GooglePlacesService (google.ts)
- WeatherService (weather.ts)
- WeatherAwareService (weatherAware.ts)
- ScheduleManager (scheduleManager.ts)
- PreferencesService (preferences.ts)

### 4.3 Context/State Management
- GlobalProvider (global-provider.tsx)
- HeartRateContext (HeartRateContext.tsx)

### 4.4 UI Components
- SignInScreen
- HealthSetupScreen
- OnboardingScreen
- ExploreScreen
- FatigueScreen
- ProfileScreen

---

## 5. DELIVERABLES

### 5.1 Documents to Create
1. **Requirements Document** (REQUIREMENTS.md)
   - Complete functional requirements
   - Complete non-functional requirements
   - Requirements traceability matrix

2. **Use Case Document** (USE_CASES.md)
   - Detailed use case descriptions
   - Use case diagram (Mermaid)
   - Activity diagrams for complex flows

3. **Test Case Document** (TEST_CASES.md)
   - Unit test cases
   - Integration test cases
   - System test cases
   - Test execution plan

4. **Class Diagram Document** (CLASS_DIAGRAMS.md)
   - Core domain class diagram (Mermaid)
   - Service layer class diagram (Mermaid)
   - Context/State class diagram (Mermaid)
   - Component interaction diagram (Mermaid)

5. **Sequence Diagrams** (SEQUENCE_DIAGRAMS.md)
   - Heart rate monitoring sequence
   - Itinerary generation sequence
   - Multi-day planning sequence
   - Fatigue calculation sequence

### 5.2 Mermaid Diagrams to Generate
1. Use Case Diagram
2. Class Diagram - Core Domain
3. Class Diagram - Services
4. Class Diagram - Context/State
5. Sequence Diagram - Heart Rate Monitoring
6. Sequence Diagram - Itinerary Generation
7. Sequence Diagram - Multi-Day Planning
8. Sequence Diagram - Fatigue Calculation
9. Activity Diagram - User Onboarding Flow
10. Activity Diagram - Trip Planning Flow
11. Component Diagram - System Architecture

---

## 6. NEXT STEPS

1. **Create Requirements Document** with detailed FRs and NFRs
2. **Create Use Case Document** with detailed scenarios and Mermaid diagram
3. **Create Test Case Document** with comprehensive test coverage
4. **Create Class Diagrams** using Mermaid for all layers
5. **Create Sequence Diagrams** for key workflows
6. **Create Activity Diagrams** for complex processes
7. **Create Component Diagram** showing system architecture
8. **Review and refine** all diagrams for accuracy

---

## Notes
- All Mermaid diagrams will be created using mermaidchart.com compatible syntax
- Diagrams will be embedded in markdown files for easy viewing
- Each diagram will include detailed descriptions
- Class relationships (inheritance, composition, aggregation, dependencies) will be clearly marked
- Use cases will include preconditions, postconditions, and alternative flows

