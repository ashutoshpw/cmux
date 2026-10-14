/** Native credentials are never exchanged for browser cookies. Use hosted sign-in. */
export function POST(): Response {
  return Response.json({ error: "legacy_auth_flow_retired" }, {
    status: 410, headers: { "Cache-Control": "no-store" },
  });
}
