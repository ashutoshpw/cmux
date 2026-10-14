import { applicationOrigin } from "../deployment/origin";
/** Deprecated provider transport helpers resolve only the owned application. */
export function stackApiBaseURL(): string { return applicationOrigin(); }
export function stackTokenIssuerBaseURL(): string { return applicationOrigin(); }
