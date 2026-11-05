import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapPoint { id: string; lat: number; lng: number; label: string; online?: boolean; popup?: React.ReactNode }

const icon = (label: string, online?: boolean, active?: boolean) => L.divIcon({
  className: '',
  html: `<div style="transform:translate(-50%,-100%);display:inline-flex;flex-direction:column;align-items:center">
    <span style="font:600 11px 'IBM Plex Mono',monospace;background:${active ? '#E8590C' : '#15181C'};color:#fff;padding:2px 6px;border-radius:4px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.3)">${label}</span>
    <span style="width:10px;height:10px;margin-top:2px;border-radius:50%;border:2px solid #fff;background:${online ? '#2B8A3E' : '#9A9DA2'};box-shadow:0 0 0 1px rgba(0,0,0,.25)"></span></div>`,
  iconSize: [0, 0],
});

function Fit({ points, track }: { points: MapPoint[]; track?: [number, number][] }) {
  const map = useMap();
  const sig = JSON.stringify(track?.length ? [track[0], track[track.length - 1], track.length] : points.map((p) => p.id));
  useEffect(() => {
    const all: [number, number][] = track?.length ? track : points.map((p) => [p.lat, p.lng]);
    if (all.length === 1) map.setView(all[0], 15);
    else if (all.length > 1) map.fitBounds(L.latLngBounds(all), { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return null;
}

export default function FleetMap({ points, track, height = 420, activeId, onSelect }: {
  points: MapPoint[]; track?: [number, number][]; height?: number | string; activeId?: string | null; onSelect?: (id: string) => void;
}) {
  const center: [number, number] = points[0] ? [points[0].lat, points[0].lng] : [18.22, -66.45];
  return (
    <MapContainer center={center} zoom={points.length ? 12 : 9} style={{ height, width: '100%' }} scrollWheelZoom>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {points.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={icon(p.label, p.online, p.id === activeId)} eventHandlers={{ click: () => onSelect?.(p.id) }}>
          {p.popup && <Popup>{p.popup}</Popup>}
        </Marker>
      ))}
      {track && track.length > 1 && <Polyline positions={track} pathOptions={{ color: '#E8590C', weight: 4, opacity: 0.85 }} />}
      <Fit points={points} track={track} />
    </MapContainer>
  );
}
