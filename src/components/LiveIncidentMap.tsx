'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getGeoHashBounds } from '@/lib/geohash';

export interface MapMarkerPoint {
  id: string;
  lat: number;
  lng: number;
  kind: 'victim' | 'responder' | 'aed' | 'obd' | 'self';
  title: string;
  subtitle?: string;
}

export interface LiveIncidentMapProps {
  center: { lat: number; lng: number };
  zoom?: number;
  markers: MapMarkerPoint[];
  geohashCells?: string[];
  radiusCircle?: { lat: number; lng: number; radiusMeters: number } | null;
  routeLine?: Array<[number, number]> | null;
  heightClassName?: string;
}

function createClinicalMarkerIcon(kind: MapMarkerPoint['kind']): L.DivIcon {
  const palette: Record<MapMarkerPoint['kind'], { bg: string; ring: string; label: string }> = {
    victim: { bg: '#EF4444', ring: 'rgba(239,68,68,0.35)', label: 'SOS' },
    responder: { bg: '#10B981', ring: 'rgba(16,185,129,0.35)', label: 'MD' },
    aed: { bg: '#06B6D4', ring: 'rgba(6,182,212,0.35)', label: 'AED' },
    obd: { bg: '#F59E0B', ring: 'rgba(245,158,11,0.35)', label: 'OBD' },
    self: { bg: '#3B82F6', ring: 'rgba(59,130,246,0.35)', label: 'YOU' },
  };
  const cfg = palette[kind];

  return L.divIcon({
    className: 'pulseguard-map-pin',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="width:34px;height:34px;border-radius:9999px;background:${cfg.ring};display:flex;align-items:center;justify-content:center;">
      <div style="width:24px;height:24px;border-radius:9999px;background:${cfg.bg};border:2px solid #05080F;color:#fff;font-size:8px;font-weight:800;font-family:monospace;display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px ${cfg.bg};">${cfg.label}</div>
    </div>`,
  });
}

export default function LiveIncidentMap({
  center,
  zoom = 14,
  markers,
  geohashCells = [],
  radiusCircle = null,
  routeLine = null,
  heightClassName = 'h-[380px]',
}: LiveIncidentMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(container, {
      center: [center.lat, center.lng],
      zoom,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    // Render GeoHash bounding cells
    for (const hash of geohashCells) {
      try {
        const b = getGeoHashBounds(hash);
        L.rectangle(
          [
            [b.minLat, b.minLng],
            [b.maxLat, b.maxLng],
          ],
          {
            color: '#06B6D4',
            weight: 1,
            dashArray: '4 4',
            fillColor: '#06B6D4',
            fillOpacity: 0.08,
          }
        )
          .bindTooltip(`GeoHash: ${hash}`, { sticky: true })
          .addTo(group);
      } catch {
        // skip invalid geohash
      }
    }

    // Render 2km responder radius ring if provided
    if (radiusCircle) {
      L.circle([radiusCircle.lat, radiusCircle.lng], {
        radius: radiusCircle.radiusMeters,
        color: '#10B981',
        weight: 1.5,
        dashArray: '6 4',
        fillColor: '#10B981',
        fillOpacity: 0.05,
      }).addTo(group);
    }

    // Render active dispatch path
    if (routeLine && routeLine.length >= 2) {
      L.polyline(routeLine, {
        color: '#34D399',
        weight: 3,
        dashArray: '8 6',
      }).addTo(group);
    }

    // Render markers
    const latLngs: Array<[number, number]> = [];
    for (const m of markers) {
      if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
      latLngs.push([m.lat, m.lng]);
      const marker = L.marker([m.lat, m.lng], {
        icon: createClinicalMarkerIcon(m.kind),
      });
      marker.bindPopup(
        `<div style="font-family:system-ui,sans-serif;min-width:160px;">
          <div style="font-weight:700;font-size:13px;color:#0F172A;">${m.title}</div>
          ${m.subtitle ? `<div style="font-size:11px;color:#334155;margin-top:3px;">${m.subtitle}</div>` : ''}
          <div style="font-family:monospace;font-size:11px;color:#475569;margin-top:4px;">${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}</div>
        </div>`
      );
      marker.addTo(group);
    }

    if (latLngs.length >= 2) {
      const bounds = L.latLngBounds(latLngs);
      map.fitBounds(bounds, { padding: [38, 38], maxZoom: 16 });
    } else if (latLngs.length === 1) {
      map.setView(latLngs[0], zoom);
    } else {
      map.setView([center.lat, center.lng], zoom);
    }
  }, [center.lat, center.lng, zoom, markers, geohashCells, radiusCircle, routeLine]);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950 ${heightClassName}`}
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
