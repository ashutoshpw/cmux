import { isUpstreamServiceHost } from "../deployment/origin";
export function defaultHostedSubrouterURL(): string {
  throw new Error("Hosted Subrouter requires an explicit fork service URL");
}

export function hostedSubrouterBaseURL(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("invalid hosted Subrouter URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("invalid hosted Subrouter URL");
  }
  if (isUpstreamServiceHost(parsed.hostname)) throw new Error("Upstream service origins are not available in this fork");
  return parsed.origin;
}
