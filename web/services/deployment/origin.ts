import { deployment } from "./config";

type Environment = Readonly<Record<string, string | undefined>>;

/** Resolve an explicit application origin without accepting an upstream destination. */
export function trustedApplicationOrigin(value: string, environment: Environment = process.env): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Application origin is invalid");
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Application origin must be an HTTP(S) origin without credentials");
  }
  const production = environment.NODE_ENV === "production" || environment.VERCEL_ENV === "production";
  if (production && (
    ![deployment.productionOrigin, deployment.stagingOrigin].some(origin => origin === url.origin)
    || url.pathname !== "/"
  )) {
    throw new Error("Production application origin must use an approved fork origin");
  }
  if (/(^|\.)cmux\.(com|dev|sh|run)$/u.test(url.hostname)
    || url.hostname.endsWith(".debussy.workers.dev")
    || url.hostname === "cmux-staging.vercel.app") {
    throw new Error("Upstream application origins are not available in this fork");
  }
  return url.origin;
}

/** Canonical first-party URLs use the deployment contract rather than request Host headers. */
export function applicationOrigin(environment: Environment = process.env): string {
  const value = environment.CMUX_APP_ORIGIN?.trim() || environment.BETTER_AUTH_URL?.trim();
  return value ? trustedApplicationOrigin(value, environment) : deployment.productionOrigin;
}
