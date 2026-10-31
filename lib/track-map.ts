import type { GeoJsonFeatureCollection, PositionTrace } from "@/lib/positions-to-geojson";

const BANDS = {
  slow: { color: "#2563eb", label: "Under 90 km/h" },
  mid: { color: "#f59e0b", label: "90–120 km/h" },
  fast: { color: "#dc2626", label: "120 km/h and over" },
} as const;

export type TrackMapPayload = {
  summary: string;
  layers: Array<{
    id: string;
    type: "line";
    slot: "top";
    data: GeoJsonFeatureCollection;
    paint: Record<string, unknown>;
    layout: Record<string, unknown>;
  }>;
  markers: Array<{ coordinates: number[]; style: "start" | "end" }>;
  legend: Array<{ label: string; color: string }>;
};

export function trackMapPayload(geojson: GeoJsonFeatureCollection, trace: PositionTrace): TrackMapPayload {
  const present = new Set(geojson.features.map((feature) => feature.properties.band));
  return {
    summary: `${trace.distanceKm} km, ${trace.durationMinutes} min`,
    layers: [
      {
        id: "track",
        type: "line",
        slot: "top",
        data: geojson,
        paint: {
          "line-color": ["match", ["get", "band"], "fast", BANDS.fast.color, "mid", BANDS.mid.color, BANDS.slow.color],
          "line-width": 4,
        },
        layout: { "line-join": "round", "line-cap": "round" },
      },
    ],
    markers: endpoints(geojson),
    legend: (["slow", "mid", "fast"] as const)
      .filter((band) => present.has(band))
      .map((band) => ({ label: BANDS[band].label, color: BANDS[band].color })),
  };
}

function endpoints(geojson: GeoJsonFeatureCollection): TrackMapPayload["markers"] {
  let first: number[] | null = null;
  let last: number[] | null = null;
  for (const feature of geojson.features) {
    const coordinates = feature.geometry.coordinates;
    if (coordinates.length === 0) continue;
    if (!first) first = coordinates[0];
    last = coordinates[coordinates.length - 1];
  }
  if (!first || !last) return [];
  const markers: TrackMapPayload["markers"] = [{ coordinates: first, style: "start" }];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    markers.push({ coordinates: last, style: "end" });
  }
  return markers;
}
