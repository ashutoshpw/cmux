import { Effect, Data } from "effect";
import { Resend } from "resend";

export class AuthMailUnavailable extends Data.TaggedError("AuthMailUnavailable")<{
  readonly message: string;
}> {}

/** Deliver auth mail through the fork's configured sender; tokens never enter logs. */
export function sendBetterAuthMail(input: { to: string; subject: string; text: string }) {
  return Effect.gen(function* () {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.CMUX_AUTH_FROM_EMAIL?.trim();
    if (!apiKey || !from) {
      return yield* new AuthMailUnavailable({ message: "RESEND_API_KEY and CMUX_AUTH_FROM_EMAIL are required for authentication email" });
    }
    return yield* Effect.tryPromise({
      try: async () => {
        const { error } = await new Resend(apiKey).emails.send({ from, ...input });
        if (error) throw new Error(error.name);
      },
      catch: () => new AuthMailUnavailable({ message: "Authentication email delivery failed" }),
    });
  });
}

export async function deliverBetterAuthMail(input: { to: string; subject: string; text: string }): Promise<void> {
  await Effect.runPromise(sendBetterAuthMail(input));
}
