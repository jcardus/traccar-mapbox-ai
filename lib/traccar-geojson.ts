// Turns Traccar route reports into GeoJSON.
// Trip reports only have the start and end. The path is the route report's fixes.

const KNOTS_TO_KMH = 1.852;
const MAX_ROUTES = 40;
const MAX_POSITIONS = 20000;
const MAX_POINTS_PER_RUN = 350;
const SIMPLIFY_TOLERANCE_DEG = 0.00008;
const GAP_MS = 10 * 60 * 1000;
const GAP_KM = 2;
const FETCH_CONCURRENCY = 6;

const BAND_COLOR = ["match", ["get", "band"], "fast", "#dc2626", "mid", "#f59e0b", "#16a34a"];

export type RouteWindowInput = {
  deviceId?: number;
  from?: string;
  to?: string;
  label?: string;
  positions?: unknown[];
};

export type RouteTrace = {
  summary: string;
  drawnRoutes: number;
  totalPoints: number;
  routes: Array<{
    label: string;
    deviceId: number;
    from: string;
    to: string;
    points: number;
    distanceKm: number;
    maxSpeedKmh: number;
    durationMinutes: number;
  }>;
  skipped: Array<{
    label: string;
    deviceId: number | null;
    from: string;
    to: string;
    reason: string;
  }>;
  message?: string;
};

export type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoFeature[];
};

export type GeojsonRoutesSuccess = {
  ok: true;
  summary: string;
  geojson: GeoJsonFeatureCollection;
  layers: MapLayer[];
  markers: MapMarker[];
  legend: Array<{ label: string; color: string }>;
  trace: RouteTrace;
};

export type GeojsonRoutesFailure = {
  ok: false;
  message: string;
  trace: RouteTrace;
};

type Fix = {
  latitude: number;
  longitude: number;
  speedKmh: number;
  fixTime: string;
  timeMs: number;
};

type RouteWindow = {
  deviceId: number;
  from: string;
  to: string;
  label: string;
  positions?: unknown[];
};

type SpeedBand = "slow" | "mid" | "fast";

type GeoFeature = {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: number[][] };
  properties: {
    band: SpeedBand;
    deviceId: number;
    label: string;
    maxSpeedKmh: number;
  };
};

type MapMarker = {
  coordinates: [number, number];
  style: "start" | "end";
  popup: string;
};

type MapLayer = {
  id: string;
  type: "line";
  slot: "top";
  data: GeoJsonFeatureCollection;
  paint: Record<string, unknown>;
  layout: { "line-cap": "round"; "line-join": "round" };
};

export function traccarBaseUrl(): string {
  const explicit = process.env.TRACCAR_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const mcp = process.env.TRACCAR_MCP_URL?.trim() ?? "";
  return mcp.replace(/\/api\/mcp\/?$/, "").replace(/\/mcp\/?$/, "");
}

export async function routesToGeojson(input: {
  summary?: string;
  routes?: RouteWindowInput[];
}): Promise<GeojsonRoutesSuccess | GeojsonRoutesFailure> {
  const windows = normalizeWindows(input);
  if (windows instanceof Error) return failure(windows.message);

  const loaded = await mapPool(windows, FETCH_CONCURRENCY, (window) => loadWindow(window));
  const features: GeoFeature[] = [];
  const markers: MapMarker[] = [];
  const trace: RouteTrace = {
    summary: input.summary?.trim() || "",
    drawnRoutes: 0,
    totalPoints: 0,
    routes: [],
    skipped: [],
  };

  for (const item of loaded) {
    if (item.skip) {
      trace.skipped.push(item.skip);
      continue;
    }
    const built = buildRouteGeometry(item.fixes, item.window);
    if (built.pointCount < 2) {
      trace.skipped.push({
        label: item.window.label,
        deviceId: item.window.deviceId,
        from: item.window.from,
        to: item.window.to,
        reason: "Fewer than two recorded fixes in this window.",
      });
      continue;
    }
    features.push(...built.features);
    markers.push(built.start, built.end);
    trace.drawnRoutes += 1;
    trace.totalPoints += built.pointCount;
    trace.routes.push({
      label: item.window.label,
      deviceId: item.window.deviceId,
      from: item.window.from,
      to: item.window.to,
      points: built.pointCount,
      distanceKm: round1(built.distanceKm),
      maxSpeedKmh: round1(built.maxSpeedKmh),
      durationMinutes: Math.round(built.durationMinutes),
    });
  }

  if (features.length === 0) {
    const why = trace.skipped.map((item) => `${item.label}: ${item.reason}`).join(" ");
    return failure(why || "No recorded fixes were returned for those windows.", trace);
  }

  const summary = trace.summary || `${trace.drawnRoutes} recorded ${trace.drawnRoutes === 1 ? "route" : "routes"}`;
  trace.summary = summary;
  if (trace.skipped.length > 0) {
    trace.message = `${trace.drawnRoutes} routes converted. ${trace.skipped.length} windows had no usable track.`;
  }

  const geojson: GeoJsonFeatureCollection = { type: "FeatureCollection", features };
  const lineLayout = { "line-cap": "round" as const, "line-join": "round" as const };
  const layers: MapLayer[] = [
    {
      id: "recorded-track-glow",
      type: "line",
      slot: "top",
      data: geojson,
      paint: { "line-color": BAND_COLOR, "line-width": 8, "line-opacity": 0.22 },
      layout: lineLayout,
    },
    {
      id: "recorded-track",
      type: "line",
      slot: "top",
      data: geojson,
      paint: { "line-color": BAND_COLOR, "line-width": 4, "line-opacity": 0.95 },
      layout: lineLayout,
    },
  ];

  return {
    ok: true,
    summary,
    geojson,
    layers,
    markers,
    legend: [
      { label: "Under 90 km/h", color: "#16a34a" },
      { label: "90–120 km/h", color: "#f59e0b" },
      { label: "Over 120 km/h", color: "#dc2626" },
    ],
    trace,
  };
}

function failure(message: string, trace?: RouteTrace): GeojsonRoutesFailure {
  return {
    ok: false,
    message,
    trace: trace ?? {
      summary: "",
      drawnRoutes: 0,
      totalPoints: 0,
      routes: [],
      skipped: [],
      message,
    },
  };
}

function normalizeWindows(input: { routes?: RouteWindowInput[] }): RouteWindow[] | Error {
  const routes = input?.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    return new Error("Pass routes: one entry per trip, with deviceId, from, and to, or with positions.");
  }
  if (routes.length > MAX_ROUTES) return new Error(`Pass at most ${MAX_ROUTES} routes in one call.`);

  const windows: RouteWindow[] = [];
  for (const route of routes) {
    const positions = Array.isArray(route?.positions) ? route.positions : undefined;
    if (positions && positions.length > MAX_POSITIONS) {
      return new Error(`Each route can include at most ${MAX_POSITIONS} positions.`);
    }
    const deviceId = Number(route?.deviceId);
    const from = typeof route?.from === "string" ? route.from : "";
    const to = typeof route?.to === "string" ? route.to : "";
    const hasWindow = Number.isInteger(deviceId) && from !== "" && to !== "";
    if (!positions && !hasWindow) {
      return new Error("Each route needs deviceId, from, and to, or a positions array.");
    }
    if ((from && Number.isNaN(Date.parse(from))) || (to && Number.isNaN(Date.parse(to)))) {
      return new Error(`Could not parse the time window ${from} to ${to}.`);
    }
    const id = Number.isInteger(deviceId) ? deviceId : 0;
    windows.push({
      deviceId: id,
      from,
      to,
      label: route.label?.trim() || (id ? `Device ${id}` : "Route"),
      positions,
    });
  }
  return windows;
}

async function loadWindow(window: RouteWindow) {
  try {
    const parsed = window.positions ?? await fetchRouteReport(window);
    const fixes = toFixes(parsed);
    if (fixes.length === 0) {
      return { window, skip: skip(window, "Route report returned no positions.") };
    }
    return { window, fixes, skip: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Route report failed.";
    return { window, skip: skip(window, reason) };
  }
}

async function fetchRouteReport(window: RouteWindow): Promise<unknown> {
  const base = traccarBaseUrl();
  if (!base) throw new Error("Set TRACCAR_BASE_URL or TRACCAR_MCP_URL.");
  const token = process.env.TRACCAR_API_TOKEN || process.env.TRACCAR_MCP_TOKEN;
  if (!token) throw new Error("Set TRACCAR_MCP_TOKEN.");
  const url = new URL("/api/reports/route", base);
  url.searchParams.append("deviceId", String(window.deviceId));
  url.searchParams.set("from", window.from);
  url.searchParams.set("to", window.to);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Traccar route report returned ${response.status}.`);
  return response.json();
}

function skip(window: RouteWindow, reason: string) {
  return {
    label: window.label,
    deviceId: window.deviceId,
    from: window.from,
    to: window.to,
    reason: reason.slice(0, 300),
  };
}

function toFixes(value: unknown): Fix[] {
  const rows = asRows(value);
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

function asRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["positions", "data", "items", "result"]) {
    const inner = (value as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner;
  }
  return [];
}

function buildRouteGeometry(fixes: Fix[], window: RouteWindow) {
  const runs = splitRuns(fixes).map((run) => downsample(simplify(run, SIMPLIFY_TOLERANCE_DEG), MAX_POINTS_PER_RUN));
  const features: GeoFeature[] = [];
  let distanceKm = 0;
  let maxSpeedKmh = 0;
  let pointCount = 0;
  let first: Fix | null = null;
  let last: Fix | null = null;

  for (const run of runs) {
    if (run.length === 0) continue;
    if (!first) first = run[0];
    last = run[run.length - 1];
    pointCount += run.length;
    for (let i = 1; i < run.length; i++) {
      const from = run[i - 1];
      const to = run[i];
      distanceKm += haversineKm(from.longitude, from.latitude, to.longitude, to.latitude);
      maxSpeedKmh = Math.max(maxSpeedKmh, from.speedKmh, to.speedKmh);
    }
    features.push(...bandLine(run, window));
  }

  const durationMinutes = first && last ? (last.timeMs - first.timeMs) / 60000 : 0;
  const stats = `${round1(distanceKm)} km · ${Math.round(durationMinutes)} min · max ${round1(maxSpeedKmh)} km/h`;
  const start: MapMarker = {
    coordinates: [round6(first?.longitude ?? 0), round6(first?.latitude ?? 0)],
    style: "start",
    popup: `${window.label}\nStart ${stamp(first?.fixTime)}\n${stats}`,
  };
  const end: MapMarker = {
    coordinates: [round6(last?.longitude ?? 0), round6(last?.latitude ?? 0)],
    style: "end",
    popup: `${window.label}\nEnd ${stamp(last?.fixTime)}\n${stats}`,
  };

  return { features, start, end, pointCount, distanceKm, maxSpeedKmh, durationMinutes };
}

function speedBand(speedKmh: number): SpeedBand {
  if (speedKmh >= 120) return "fast";
  if (speedKmh >= 90) return "mid";
  return "slow";
}

function coordOf(fix: Fix): [number, number] {
  return [round6(fix.longitude), round6(fix.latitude)];
}

function bandLine(run: Fix[], window: RouteWindow): GeoFeature[] {
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
      properties: { band, deviceId: window.deviceId, label: window.label, maxSpeedKmh },
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

function splitRuns(fixes: Fix[]): Fix[][] {
  const runs: Fix[][] = [];
  let current: Fix[] = [];
  for (const fix of fixes) {
    const previous = current[current.length - 1];
    const gap = previous
      && (fix.timeMs - previous.timeMs > GAP_MS
        || haversineKm(previous.longitude, previous.latitude, fix.longitude, fix.latitude) > GAP_KM);
    if (gap) {
      if (current.length > 0) runs.push(current);
      current = [];
    }
    current.push(fix);
  }
  if (current.length > 0) runs.push(current);
  return runs;
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

function stamp(value: string | undefined) {
  if (!value) return "";
  return value.replace("T", " ").replace(/\.\d+/, "").replace("+00:00", " UTC");
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round6(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
