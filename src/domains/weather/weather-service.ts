export type WeatherContext = {
    location: string;
    temperature: number;
    condition: string;
    humidity: number;
    wind_speed: number;
  };
  
  export async function getWeather(
    latitude: number,
    longitude: number,
    location: string,
  ): Promise<WeatherContext> {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${latitude}` +
      `&longitude=${longitude}` +
      `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`;
  
    const response = await fetch(url);
  
    if (!response.ok) {
      throw new Error("Weather API request failed.");
    }
  
    const data = await response.json();
  
    return {
      location,
      temperature: data.current.temperature_2m,
      condition: mapWeatherCode(data.current.weather_code),
      humidity: data.current.relative_humidity_2m,
      wind_speed: data.current.wind_speed_10m,
    };
  }
  
  function mapWeatherCode(code: number): string {
    if (code === 0) return "晴";
    if ([1, 2, 3].includes(code)) return "多云";
    if ([61, 63, 65].includes(code)) return "雨";
    return "未知";
  }