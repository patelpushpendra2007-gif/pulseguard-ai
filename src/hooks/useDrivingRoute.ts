'use client';

import { useEffect, useState } from 'react';

export interface RouteCoordinate {
  lat: number;
  lng: number;
}

export interface DrivingRoute {
  coordinates: Array<[number, number]>;
  distanceMeters: number;
  durationSeconds: number;
}

interface DrivingRouteState {
  route: DrivingRoute | null;
  loading: boolean;
  error: string | null;
}

interface DrivingRouteResult {
  key: string;
  route: DrivingRoute | null;
  error: string | null;
}

interface OsrmResponse {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: {
      coordinates?: Array<[number, number]>;
    };
  }>;
}

function routeKey(point: RouteCoordinate | null): string {
  return point ? `${point.lat.toFixed(4)},${point.lng.toFixed(4)}` : '';
}

export function useDrivingRoute(
  origin: RouteCoordinate | null,
  destination: RouteCoordinate | null,
  enabled: boolean
): DrivingRouteState {
  const originKey = routeKey(origin);
  const destinationKey = routeKey(destination);
  const requestKey = `${enabled}:${originKey}:${destinationKey}`;
  const [result, setResult] = useState<DrivingRouteResult | null>(null);

  useEffect(() => {
    if (!enabled || !originKey || !destinationKey) {
      return;
    }

    const [originLat, originLng] = originKey.split(',').map(Number);
    const [destinationLat, destinationLng] = destinationKey.split(',').map(Number);
    const controller = new AbortController();
    let active = true;

    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${originLng},${originLat};${destinationLng},${destinationLat}` +
      '?overview=full&geometries=geojson';

    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Routing service returned ${response.status}.`);
        const payload = (await response.json()) as OsrmResponse;
        const route = payload.routes?.[0];
        const geometry = route?.geometry?.coordinates;
        if (
          payload.code !== 'Ok' ||
          !route ||
          !Number.isFinite(route.distance) ||
          !Number.isFinite(route.duration) ||
          !geometry ||
          geometry.length < 2 ||
          geometry.some(
            (coordinate) =>
              coordinate.length < 2 ||
              !Number.isFinite(coordinate[0]) ||
              !Number.isFinite(coordinate[1])
          )
        ) {
          throw new Error('No drivable route is available for these coordinates.');
        }

        if (active) {
          setResult({
            key: requestKey,
            route: {
              coordinates: geometry.map(([lng, lat]) => [lat, lng]),
              distanceMeters: route.distance as number,
              durationSeconds: route.duration as number,
            },
            error: null,
          });
        }
      })
      .catch(() => {
        if (active) {
          setResult({
            key: requestKey,
            route: null,
            error: 'Road route unavailable; showing a direct-distance estimate.',
          });
        }
      })
      .finally(() => window.clearTimeout(timeoutId));

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [destinationKey, enabled, originKey, requestKey]);

  const hasCoordinates = enabled && Boolean(originKey && destinationKey);
  const currentResult = result?.key === requestKey ? result : null;

  return {
    route: currentResult?.route ?? null,
    loading: hasCoordinates && !currentResult,
    error: currentResult?.error ?? null,
  };
}
