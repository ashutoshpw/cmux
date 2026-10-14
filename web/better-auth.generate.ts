import { betterAuth } from "better-auth";
import { betterAuthOptions } from "./services/auth/betterAuthOptions";

// Schema generation is deliberately independent of runtime credentials and database connectivity.
export const auth = betterAuth({
  ...betterAuthOptions("https://cmux.w3dev.app"),
  secret: "cmux-schema-generation-placeholder-not-a-runtime-secret",
});
