import { ResizeMode, Video } from "expo-av";
import * as IntentLauncher from "expo-intent-launcher";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function Watch() {
  const [showVideo, setShowVideo] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const videoRef = useRef<Video>(null);
  const router = useRouter();  

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 1000,
        useNativeDriver: true,
      }).start(() => setShowVideo(true));
    }, 5000);

    return () => clearTimeout(timer);
  }, []);
  
  const handleSkip = () => {
    Alert.alert(
      "Skip connection?",
      "Without health data, the adaptive model will be less accurate.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Continue", onPress: () => router.replace("/(root)/(tabs)") },
      ]
    );
  };

  const handleConnect = async () => {
    try {
      // Open Android Bluetooth settings so the user can pair their watch
      await IntentLauncher.startActivityAsync(
        "android.settings.BLUETOOTH_SETTINGS"
      );
      // After the user pairs, move to the test screen
      router.replace("/onboarding/test_connection");
    } catch (e: any) {
      Alert.alert("Couldn't open Bluetooth settings", String(e?.message ?? e));
    }
  };
  return (
    <SafeAreaView className="flex-1 bg-black">
      {/* Force status bar to be black text on black background */}
      <StatusBar style="light" backgroundColor="#000" />

      {!showVideo ? (
        <Animated.Text
          style={{ opacity: fadeAnim }}
          className="text-white text-lg text-center px-8 mt-40"
        >
          Please connect to Galaxy Watch for the best experience
        </Animated.Text>
      ) : (
        <View style={styles.container}>
          <Video
            ref={videoRef}
            source={require("@/assets/animation/WatchAnimation.mp4")}
            style={styles.video}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay
            isLooping
          />

          <View style={styles.overlay}>
            <TouchableOpacity onPress = {handleConnect} className="bg-primary-300 rounded-full px-6 py-3 mb-4">
              <Text className="text-white text-lg font-rubik-medium">
                Connect to Galaxy Watch
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSkip}>
              <Text className="text-white underline">Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  video: {
    width: "100%",
    height: "100%",
  },
  overlay: {
    position: "absolute",
    bottom: 60,
    alignItems: "center",
    width: "100%",
  },
});
