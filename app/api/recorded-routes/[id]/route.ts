import { getRecordedRoute } from "@/lib/recorded-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!ROUTE_ID.test(id)) {
    return Response.json({ message: "Unknown track." }, { status: 404 });
  }
  const stored = getRecordedRoute(id);
  if (!stored) {
    return Response.json({ message: "Unknown track." }, { status: 404 });
  }
  return Response.json(
    { mapboxRender: stored.mapboxRender },
    { headers: { "Cache-Control": "no-store" } },
  );
}
