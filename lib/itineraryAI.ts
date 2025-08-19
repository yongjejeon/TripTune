// lib/itineraryAI.ts — refined with coordinates
import AsyncStorage from "@react-native-async-storage/async-storage";
import OpenAI from "openai";
import { makeCompactPlacesList } from "./google";

const client = new OpenAI({
  apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY!,
});

export const generateItinerary = async (
  places: any[],
  userCoords: { lat: number; lng: number }
) => {
  const storedPrefs = await AsyncStorage.getItem("userPreferences");
  const prefs = storedPrefs ? JSON.parse(storedPrefs) : {};

  // compact list already includes lat/lng
  const compactList = makeCompactPlacesList(places);

  const prompt = `
You are a highly experienced Seoul travel planner. Based on the following inputs, create a **1‑day itinerary**.

User Coordinates:
latitude: ${userCoords.lat}, longitude: ${userCoords.lng}

User Preferences:
${JSON.stringify(prefs, null, 2)}

Nearby Places (compact ranked list):
${JSON.stringify(compactList, null, 2)}

Instructions:
- Choose **5–6 destinations** from the list (not always the top-rated).
- Skip meal recommendations—just allocate fixed time blocks for lunch and dinner.
- Give realistic **start and end times** based on average visit durations.
- If a location is large (e.g. major museum or park), allocate more time.
- Provide **public transit directions** between sites (e.g. “Take bus #... to station ..., then subway line …”).
- Respect user interest levels (weight and preferredDuration).
- Each itinerary item **must include lat and lng** of the place from the compact list.
- **Output valid JSON only** in the following format:

{
  "itinerary": [
    {
      "order": 1,
      "name": "Place Name",
      "category": "museum/park/etc",
      "lat": 37.5665,
      "lng": 126.9780,
      "start_time": "09:00",
      "end_time": "10:30",
      "estimated_duration": "1.5 hrs",
      "travel_instructions": "bus/subway route details",
      "reason": "Why this was chosen"
    }
  ]
}`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are an expert Seoul itinerary planner." },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
  });

  let raw = response.choices[0].message?.content?.trim() || "";
  raw = raw.replace(/```json|```/g, "").trim();

  try {
    const result = JSON.parse(raw);
    return result;
  } catch {
    console.warn("⚠️ AI output not valid JSON:", raw);
    return { itinerary: [{ order: 0, name: raw }] };
  }
};
