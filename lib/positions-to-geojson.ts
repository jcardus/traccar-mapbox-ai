// Turns a positions array into GeoJSON.

const KNOTS_TO_KMH = 1.852;
const MAX_POSITIONS = 20000;
const MAX_POINTS_PER_RUN = 350;
const SIMPLIFY_TOLERANCE_DEG = 0.00008;

export type PositionTrace = {
  points: number;
  distanceKm: number;
  maxSpeedKmh: number;
  durationMinutes: number;
  from: string;
  to: string;
  message?: string;
};

export type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoFeature[];
};

export type PositionsGeojsonSuccess = {
  ok: true;
  geojson: GeoJsonFeatureCollection;
  trace: PositionTrace;
};

export type PositionsGeojsonFailure = {
  ok: false;
  message: string;
  trace: PositionTrace;
};

type Fix = {
  latitude: number;
  longitude: number;
  speedKmh: number;
  fixTime: string;
  timeMs: number;
};

type SpeedBand = "slow" | "mid" | "fast";

type GeoFeature = {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: number[][] };
  properties: {
    band: SpeedBand;
    maxSpeedKmh: number;
  };
};

export function positionsToGeojson(positions: unknown[]): PositionsGeojsonSuccess | PositionsGeojsonFailure {
  if (!Array.isArray(positions) || positions.length === 0) {
    return failure("Pass a positions array.");
  }
  if (positions.length > MAX_POSITIONS) {
    return failure(`A track can include at most ${MAX_POSITIONS} positions.`);
  }

  const fixes = toFixes(positions);
  if (fixes.length < 2) {
    return failure("Fewer than two recorded fixes in the positions array.");
  }

  const built = buildGeometry(fixes);
  if (built.pointCount < 2 || built.features.length === 0) {
    return failure("Fewer than two recorded fixes in the positions array.");
  }

  const trace: PositionTrace = {
    points: built.pointCount,
    distanceKm: round1(built.distanceKm),
    maxSpeedKmh: round1(built.maxSpeedKmh),
    durationMinutes: Math.round(built.durationMinutes),
    from: built.first?.fixTime ?? "",
    to: built.last?.fixTime ?? "",
  };

  return {
    ok: true,
    geojson: { type: "FeatureCollection", features: built.features },
    trace,
  };
}

function failure(message: string): PositionsGeojsonFailure {
  return {
    ok: false,
    message,
    trace: {
      points: 0,
      distanceKm: 0,
      maxSpeedKmh: 0,
      durationMinutes: 0,
      from: "",
      to: "",
      message,
    },
  };
}

function toFixes(rows: unknown[]): Fix[] {
  const fixes: Fix[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    if (item.valid === false) continue;
    const latitude = Number(item.latitude);
    const longitude = Number(item.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    const fixTime = typeof item.fixTime === "string"
      ? item.fixTime
      : typeof item.deviceTime === "string"
        ? item.deviceTime
        : "";
    const timeMs = Date.parse(fixTime);
    if (Number.isNaN(timeMs)) continue;
    const knots = Number(item.speed);
    fixes.push({
      latitude,
      longitude,
      speedKmh: Number.isFinite(knots) ? knots * KNOTS_TO_KMH : 0,
      fixTime,
      timeMs,
    });
  }
  fixes.sort((a, b) => a.timeMs - b.timeMs);
  return fixes.filter((fix, index) => {
    if (index === 0) return true;
    const previous = fixes[index - 1];
    return previous.latitude !== fix.latitude || previous.longitude !== fix.longitude;
  });
}

function buildGeometry(fixes: Fix[]) {
  const run = downsample(simplify(fixes, SIMPLIFY_TOLERANCE_DEG), MAX_POINTS_PER_RUN);
  let distanceKm = 0;
  let maxSpeedKmh = 0;
  for (let i = 1; i < run.length; i++) {
    const from = run[i - 1];
    const to = run[i];
    distanceKm += haversineKm(from.longitude, from.latitude, to.longitude, to.latitude);
    maxSpeedKmh = Math.max(maxSpeedKmh, from.speedKmh, to.speedKmh);
  }
  const first = run[0] ?? null;
  const last = run[run.length - 1] ?? null;
  const durationMinutes = first && last ? (last.timeMs - first.timeMs) / 60000 : 0;
  return {
    features: bandLine(run),
    pointCount: run.length,
    distanceKm,
    maxSpeedKmh,
    durationMinutes,
    first,
    last,
  };
}

function speedBand(speedKmh: number): SpeedBand {
  if (speedKmh >= 120) return "fast";
  if (speedKmh >= 90) return "mid";
  return "slow";
}

function coordOf(fix: Fix): [number, number] {
  return [round6(fix.longitude), round6(fix.latitude)];
}

function bandLine(run: Fix[]): GeoFeature[] {
  if (run.length < 2) return [];
  const features: GeoFeature[] = [];
  let chunk: Fix[] = [run[0]];
  let current = speedBand(run[1].speedKmh);
  const emit = (points: Fix[], band: SpeedBand) => {
    if (points.length < 2) return;
    const maxSpeedKmh = round1(points.reduce((max, fix) => Math.max(max, fix.speedKmh), 0));
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: points.map(coordOf) },
      properties: { band, maxSpeedKmh },
    });
  };
  for (let i = 1; i < run.length; i++) {
    const next = speedBand(run[i].speedKmh);
    if (next !== current) {
      emit(chunk, current);
      chunk = [run[i - 1]];
      current = next;
    }
    chunk.push(run[i]);
  }
  emit(chunk, current);
  return features;
}

function simplify(points: Fix[], tolerance: number): Fix[] {
  if (points.length <= 2) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const distance = perpendicularDistance(points[i], points[start], points[end]);
      if (distance > maxDist) {
        maxDist = distance;
        index = i;
      }
    }
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function perpendicularDistance(point: Fix, start: Fix, end: Fix) {
  const dx = end.longitude - start.longitude;
  const dy = end.latitude - start.latitude;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.longitude - start.longitude, point.latitude - start.latitude);
  }
  const t = ((point.longitude - start.longitude) * dx + (point.latitude - start.latitude) * dy) / (dx * dx + dy * dy);
  return Math.hypot(point.longitude - (start.longitude + t * dx), point.latitude - (start.latitude + t * dy));
}

function downsample(points: Fix[], maxPoints: number): Fix[] {
  if (points.length <= maxPoints) return points;
  const sampled: Fix[] = [];
  const last = points.length - 1;
  for (let i = 0; i < maxPoints; i++) {
    const index = Math.round((i * last) / (maxPoints - 1));
    const fix = points[index];
    if (sampled[sampled.length - 1] !== fix) sampled.push(fix);
  }
  return sampled;
}

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round6(value: number) {
  return Math.round(value * 1e6) / 1e6;
}
