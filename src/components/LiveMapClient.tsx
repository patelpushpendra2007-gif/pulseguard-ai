'use client';

import dynamic from 'next/dynamic';
import type { LiveIncidentMapProps } from './LiveIncidentMap';

const LiveIncidentMap = dynamic(() => import('./LiveIncidentMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[380px] w-full items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-xs font-mono text-slate-400">
      Initializing OpenStreetMap Leaflet Tactical View...
    </div>
  ),
});

export default function LiveMapClient(props: LiveIncidentMapProps) {
  return <LiveIncidentMap {...props} />;
}
