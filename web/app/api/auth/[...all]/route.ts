import { connection } from "next/server";
import { getBetterAuth } from "../../../../services/auth/betterAuthServer";


// Better Auth owns parsing, CSRF, rate limiting, typed protocol errors and cookies.
export async function GET(request: Request) { await connection(); return getBetterAuth().handler(request); }
export function POST(request: Request) { return getBetterAuth().handler(request); }
