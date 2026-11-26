import ngeohash from 'ngeohash';

export interface GeoCoordinates {
  lat: number;
  lng: number;
}

export interface GeoBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export function encodeGeoHash(lat: number, lng: number, precision = 7): string {
  return ngeohash.encode(lat, lng, precision);
}

export function decodeGeoHash(hash: string): GeoCoordinates {
  const decoded = ngeohash.decode(hash);
  return { lat: decoded.latitude, lng: decoded.longitude };
}

export function getGeoHashBounds(hash: string): GeoBounds {
  const [minLat, minLng, maxLat, maxLng] = ngeohash.decode_bbox(hash);
  return { minLat, minLng, maxLat, maxLng };
}

export function getGeoHashNeighbors(hash: string): string[] {
  return [hash, ...ngeohash.neighbors(hash)];
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusMeters = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isWithinRadiusMeters(
  a: GeoCoordinates,
  b: GeoCoordinates,
  radiusMeters = 2000
): boolean {
  return haversineMeters(a.lat, a.lng, b.lat, b.lng) <= radiusMeters;
}

export function estimateEtaSeconds(
  distanceMeters: number,
  speedMetersPerSecond = 3.2
): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 0;
  const effectiveSpeed = Math.max(1.2, speedMetersPerSecond);
  return Math.round(distanceMeters / effectiveSpeed);
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '--';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Arriving';
  const mins = Math.floor(seconds / 60);
  const remSecs = seconds % 60;
  if (mins === 0) return `${remSecs}s`;
  return `${mins}m ${remSecs.toString().padStart(2, '0')}s`;
}
