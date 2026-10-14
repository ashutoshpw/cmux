export async function GET(_request?: Request): Promise<Response> { return Response.json({ error: "legacy_auth_flow_retired" }, { status: 410 }); }
export const POST = GET;
