import AsyncStorage from "@react-native-async-storage/async-storage";
import Slider from "@react-native-community/slider";
import React, { useEffect, useState } from "react";
import {
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// Define keys and display labels
const CATEGORIES: Record<string, string> = {
  museum: "Museums",
  art_gallery: "Art Galleries",
  historical_site: "Historical Sites",
  religious_site: "Religious Sites",
  park: "Parks",
  beach: "Beaches",
  restaurant: "Restaurants",
  cafe: "Cafes",
  shopping: "Shopping",
  zoo: "Zoos",
  aquarium: "Aquariums",
  nightlife: "Nightlife",
  amusement_park: "Amusement Parks",
  sports: "Sports",
  spa: "Spas",
};

const PreferenceScreen = () => {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");

  // Initialize preferences dynamically from CATEGORIES
  const [preferences, setPreferences] = useState(
    Object.keys(CATEGORIES).reduce(
      (acc, key) => ({
        ...acc,
        [key]: { weight: 5, duration: 60 },
      }),
      {} as Record<string, { weight: number; duration: number }>
    )
  );

  // Load saved preferences
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const stored = await AsyncStorage.getItem("userPreferences");
        if (stored) {
          const parsed = JSON.parse(stored);
          setHeight(parsed.height || "");
          setWeight(parsed.weight || "");
          setPreferences(parsed.preferences || preferences);
        }
      } catch (err) {
        console.error("Failed to load preferences", err);
      }
    };
    loadPreferences();
  }, []);

  // Save preferences
  const savePreferences = async () => {
    try {
      const data = {
        height,
        weight,
        preferences,
      };
      await AsyncStorage.setItem("userPreferences", JSON.stringify(data));
      alert("Preferences saved successfully!");
    } catch (err) {
      console.error("Failed to save preferences", err);
    }
  };

  // Update sliders
  const handleSliderChange = (
    key: keyof typeof preferences,
    field: "weight" | "duration",
    value: number
  ) => {
    setPreferences((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  return (
    <SafeAreaView className="h-full bg-white">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-32 px-7"
      >
        <Text className="text-2xl font-rubik-bold mb-4">Your Preferences</Text>

        {/* Personal Info */}
        <Text className="text-lg font-rubik-semibold mb-2">Personal Info</Text>
        <TextInput
          placeholder="Height (cm)"
          keyboardType="numeric"
          value={height}
          onChangeText={setHeight}
          className="border px-4 py-2 rounded mb-3 border-gray-300"
        />
        <TextInput
          placeholder="Weight (kg)"
          keyboardType="numeric"
          value={weight}
          onChangeText={setWeight}
          className="border px-4 py-2 rounded mb-6 border-gray-300"
        />

        {/* Interests with Sliders */}
        <Text className="text-lg font-rubik-semibold mb-2">Your Interests</Text>
        {Object.keys(preferences).map((key) => {
          const pref = preferences[key];
          return (
            <View key={key} className="mb-8">
              <Text className="text-md font-rubik-medium mb-1">
                {CATEGORIES[key]} {/* user-friendly label */}
              </Text>

              {/* Weight slider */}
              <Text className="text-sm mb-1">
                Interest Level: {pref.weight}/10
              </Text>
              <Slider
                style={{ width: "100%", height: 40 }}
                minimumValue={0}
                maximumValue={10}
                step={1}
                value={pref.weight}
                onValueChange={(value) =>
                  handleSliderChange(key, "weight", Math.round(value))
                }
                minimumTrackTintColor="#0061ff"
                maximumTrackTintColor="#ccc"
              />

              {/* Duration slider */}
              <Text className="text-sm mt-4 mb-1">
                Preferred Duration: {pref.duration} mins
              </Text>
              <Slider
                style={{ width: "100%", height: 40 }}
                minimumValue={30}
                maximumValue={180}
                step={10}
                value={pref.duration}
                onValueChange={(value) =>
                  handleSliderChange(key, "duration", Math.round(value))
                }
                minimumTrackTintColor="#0061ff"
                maximumTrackTintColor="#ccc"
              />
            </View>
          );
        })}

        {/* Save Button */}
        <TouchableOpacity
          onPress={savePreferences}
          className="bg-primary-100 py-3 px-6 rounded mt-8"
        >
          <Text className="text-white text-center font-rubik-semibold">
            Save Preferences
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

export default PreferenceScreen;
