export interface Position { lat: number; lng: number; accuracy: number; speed_kmh: number | null; heading: number | null }

/** Ubicación actual del teléfono. Resuelve null si el usuario la niega o no hay señal. */
export function getPosition(timeoutMs = 12000): Promise<Position | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({
        lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy,
        speed_kmh: p.coords.speed != null ? p.coords.speed * 3.6 : null, heading: p.coords.heading,
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}
