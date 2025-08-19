import axios from "axios";

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;

export async function testDirections() {
  try {
    const res = await axios.get(
      "https://maps.googleapis.com/maps/api/directions/json",
      {
        params: {
          origin: "37.5563,126.9723", // Seoul Station
          destination: "37.5796,126.9770", // Gyeongbokgung Palace
          mode: "transit", // ✅ try transit since walking/driving failed
          key: API_KEY,
        },
      }
    );

    console.log("Directions API raw response:", JSON.stringify(res.data, null, 2));

    if (res.data.status !== "OK") {
      throw new Error(`Directions API failed: ${res.data.status}`);
    }

    const route = res.data.routes?.[0];
    const leg = route.legs[0];

    console.log("✅ Directions API Test Success!");
    console.log(`From: ${leg.start_address}`);
    console.log(`To: ${leg.end_address}`);
    console.log(`Distance: ${leg.distance.text}`);
    console.log(`Duration: ${leg.duration.text}`);

    return {
      from: leg.start_address,
      to: leg.end_address,
      distance: leg.distance.text,
      duration: leg.duration.text,
    };
  } catch (err) {
    console.error("❌ Directions API Test Failed:", err);
    return null;
  }
}
