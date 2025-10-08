import { Stack } from "expo-router";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";

export default function OnboardingLayout() {
  // Ensure Android window background is black (prevents white flash/strip)
  useEffect(() => {
    SystemUI.setBackgroundColorAsync("#000");
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShown: false,                 // no RN header
        contentStyle: { backgroundColor: "#000" }, // black content bg
        statusBarStyle: "light",            // iOS (and some Androids)
       
      }}
    />
  );
}
