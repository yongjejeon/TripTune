import "react-native-get-random-values";
import { GlobalProvider } from "@/lib/global-provider";
import { HeartRateProvider } from "@/contexts/HeartRateContext";
import { useFonts } from "expo-font";
import { SplashScreen, Stack } from "expo-router";
import { useEffect } from "react";
import "./global.css";


export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    "Rubik-Bold": require('../assets/fonts/Rubik-Bold.ttf'),
    "Rubik-ExtraBold": require('../assets/fonts/Rubik-ExtraBold.ttf'),
    "Rubik-Light": require('../assets/fonts/Rubik-Light.ttf'),
    "Rubik-Medium": require('../assets/fonts/Rubik-Medium.ttf'),
    "Rubik-Regular": require('../assets/fonts/Rubik-Regular.ttf'),
    "Rubik-Semibold": require('../assets/fonts/Rubik-SemiBold.ttf'),
  });

  useEffect(() => {
  if (fontsLoaded) {
    SplashScreen.hideAsync();
  }
  }, [fontsLoaded]);

  if(!fontsLoaded) return null;

  return (
    <GlobalProvider>
      <HeartRateProvider>
        <Stack screenOptions={{headerShown: false}}/>
      </HeartRateProvider>
    </GlobalProvider>
  );
}
