const KINDS: Record<string, Set<string>> = {
  positions: new Set(["deviceId", "from", "to", "id"]),
  route: new Set(["deviceId", "groupId", "from", "to"]),
};

export function traccarPositionsUri(uri: string): string | null {
  const value = uri.trim();
  if (!value.startsWith("traccar://")) return null;
  const queryStart = value.indexOf("?");
  if (queryStart < "traccar://".length) return null;
  const kind = value.slice("traccar://".length, queryStart);
  const allowed = KINDS[kind];
  if (!allowed) return null;
  const query = value.slice(queryStart + 1);
  if (!query) return null;
  for (const part of query.split("&")) {
    const separator = part.indexOf("=");
    if (separator <= 0) return null;
    let key: string;
    try {
      key = decodeURIComponent(part.slice(0, separator).replace(/\+/g, " "));
    } catch {
      return null;
    }
    if (!allowed.has(key)) return null;
  }
  return value;
}

export function positionsFromResource(text: string): unknown[] | null {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
