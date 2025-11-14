#!/usr/bin/env bash
set -euo pipefail

# Use Expo to install RN/Expo libs with the correct versions for your SDK
npx expo install \
  @react-native-async-storage/async-storage \
  expo-image \
  expo-location \
  react-native-gesture-handler \
  react-native-safe-area-context \
  react-native-calendars

# Regular npm packages
npm install \
  axios \
  openai
