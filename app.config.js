// app.config.js
require('dotenv').config({ path: '.env.local' });
export default {
  expo: {
    name: "react_native_restate",
    slug: "react_native_restate",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "reactnativerestate",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.anonymous.react-native-restate"
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/icon.png",
        backgroundColor: "#ffffff",
      },
      edgeToEdgeEnabled: true,
      package: "com.anonymous.react_native_restate",
      minSdkVersion: 26, 
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_API_KEY,
        },
      },
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          resizeMode: "cover",
          backgroundColor: "#ffffff",
          enableFullScreenImage_Legacy: true,
        },
      ],
      "expo-health-connect",
      [
        "expo-font",
        {
          fonts: [
            "./assets/fonts/Rubik-Bold.ttf",
            "./assets/fonts/Rubik-ExtraBold.ttf",
            "./assets/fonts/Rubik-Medium.ttf",
            "./assets/fonts/Rubik-Light.ttf",
            "./assets/fonts/Rubik-Regular.ttf",
            "./assets/fonts/Rubik-SemiBold.ttf",
          ],
        },
      ],
      ["expo-build-properties", { android: { minSdkVersion: 26 } }],
    ],
    experiments: {
      typedRoutes: true,
    },
  },
};