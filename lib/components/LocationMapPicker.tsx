import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, MapPressEvent, MapViewProps, MarkerDragEndEvent, PROVIDER_GOOGLE, Region } from "react-native-maps";

type LatLng = { lat: number; lng: number };

type Props = {
  value?: LatLng | null;
  onChange?: (next: LatLng) => void;
  initialRegionOverride?: Region;
  mapProps?: Partial<MapViewProps>;
};

const DEFAULT_REGION: Region = {
  latitude: 24.4539,
  longitude: 54.3773,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

const toMapCoord = (point: LatLng) => ({ latitude: point.lat, longitude: point.lng });

const LocationMapPicker: React.FC<Props> = ({ value, onChange, initialRegionOverride, mapProps }) => {
  const [marker, setMarker] = useState<{ latitude: number; longitude: number } | null>(
    value ? toMapCoord(value) : null
  );

  const [region, setRegion] = useState<Region>(() => {
    if (value) {
      return {
        latitude: value.lat,
        longitude: value.lng,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    if (initialRegionOverride) {
      return initialRegionOverride;
    }
    return DEFAULT_REGION;
  });

  useEffect(() => {
    if (!value) return;
    const next = toMapCoord(value);
    setMarker(next);
    setRegion((prev) => ({
      ...prev,
      latitude: value.lat,
      longitude: value.lng,
    }));
  }, [value]);

  const handlePress = useCallback(
    (event: MapPressEvent) => {
      const next = event.nativeEvent.coordinate;
      setMarker(next);
      setRegion((prev) => ({
        ...prev,
        latitude: next.latitude,
        longitude: next.longitude,
      }));
      onChange?.({ lat: next.latitude, lng: next.longitude });
    },
    [onChange]
  );

  const handleDragEnd = useCallback(
    (event: MarkerDragEndEvent) => {
      const next = event.nativeEvent.coordinate;
      setMarker(next);
      onChange?.({ lat: next.latitude, lng: next.longitude });
    },
    [onChange]
  );

  const memoRegion = useMemo(() => region, [region]);

  return (
    <View style={styles.container}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={memoRegion}
        region={memoRegion}
        onPress={handlePress}
        onRegionChangeComplete={setRegion}
        {...mapProps}
      >
        {marker && (
          <Marker
            coordinate={marker}
            draggable
            onDragEnd={handleDragEnd}
          />
        )}
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: 260,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#e5e7eb",
  },
  map: {
    flex: 1,
  },
});

export default LocationMapPicker;
