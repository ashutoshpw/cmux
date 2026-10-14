import { getBetterAuth } from "../../../services/auth/betterAuthServer";
import { applicationOrigin } from "../../../services/deployment/origin";
export async function GET(request: Request): Promise<Response> {
  await connection();
  const result = await getBetterAuth().api.signOut({ headers: request.headers, asResponse: true });
  const headers = new Headers({ location: new URL("/handler/sign-in", applicationOrigin()).toString() });
  for (const cookie of result.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}
import { connection } from "next/server";
