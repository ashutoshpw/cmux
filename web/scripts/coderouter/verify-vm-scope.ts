// This operator depended on upstream SDK impersonation and legacy credentials.
// Replacement workflows must authenticate with a fork-owned Better Auth session.
// Refuse before importing dependencies, reading configuration or contacting providers.
throw new Error("legacy_auth_operator_retired");
