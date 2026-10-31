import type { TrackMapPayload } from "@/lib/track-map";

const MAX_ROUTES = 24;

type StoredRoute = {
  mapboxRender: TrackMapPayload;
};

function routes(): Map<string, StoredRoute> {
  const holder = globalThis as typeof globalThis & { __recordedRoutes?: Map<string, StoredRoute> };
  if (!holder.__recordedRoutes) holder.__recordedRoutes = new Map();
  return holder.__recordedRoutes;
}

export function saveRecordedRoute(mapboxRender: TrackMapPayload): string {
  const id = crypto.randomUUID();
  const stored = routes();
  stored.set(id, { mapboxRender });
  while (stored.size > MAX_ROUTES) {
    const oldest = stored.keys().next().value;
    if (oldest === undefined) break;
    stored.delete(oldest);
  }
  return id;
}

export function getRecordedRoute(id: string): StoredRoute | null {
  return routes().get(id) ?? null;
}
