import axios from 'axios';

const WEATHER_API_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_KEY;
console.log("[Weather] Key configured:", WEATHER_API_KEY);
export async function getWeather(lat: number, lon: number) {
  try {
    const res = await axios.get(
      'https://api.openweathermap.org/data/2.5/weather',
      {
        params: {
          lat,
          lon,
          appid: WEATHER_API_KEY,
          units: 'metric',
        },
      }
    );

    const weather = res.data.weather?.[0]?.main;
    

    return weather; // e.g., "Clear", "Rain", "Clouds"
  } catch (err) {
    console.error('Weather fetch failed:', err);
    return null;
  }
}
