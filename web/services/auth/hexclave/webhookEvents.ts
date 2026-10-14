import { object, string, number, boolean, array, mixed, ValidationError, type InferType, type ISchema } from "yup";
const userSchema = object({ id: string().defined(), primary_email: string().nullable().defined(), display_name: string().nullable().defined(), is_anonymous: boolean().defined(), client_read_only_metadata: mixed<Record<string, unknown>>().nullable().defined(), signed_up_at_millis: number().defined() });
const teamSchema = object({ id: string().defined(), display_name: string().defined(), client_read_only_metadata: mixed<Record<string, unknown>>().nullable().defined(), created_at_millis: number().defined() });
const membershipSchema = object({ team_id: string().defined(), user_id: string().defined() });
const teamPermissionSchema = membershipSchema.shape({ id: string().defined() });
const projectPermissionSchema = object({ id: string().defined(), user_id: string().defined() });
function historicalEvent<T extends ISchema<unknown>>(type: string, schema: T) { return { type, schema }; }
const userCreatedWebhookEvent = historicalEvent("user.created", userSchema);
const userUpdatedWebhookEvent = historicalEvent("user.updated", userSchema);
const userDeletedWebhookEvent = historicalEvent("user.deleted", object({ id: string().defined(), teams: array(object({ id: string().defined() })).defined() }));
const teamCreatedWebhookEvent = historicalEvent("team.created", teamSchema);
const teamUpdatedWebhookEvent = historicalEvent("team.updated", teamSchema);
const teamDeletedWebhookEvent = historicalEvent("team.deleted", object({ id: string().defined() }));
const teamMembershipCreatedWebhookEvent = historicalEvent("team_membership.created", membershipSchema);
const teamMembershipDeletedWebhookEvent = historicalEvent("team_membership.deleted", membershipSchema);
const teamPermissionCreatedWebhookEvent = historicalEvent("team_permission.created", teamPermissionSchema);
const teamPermissionDeletedWebhookEvent = historicalEvent("team_permission.deleted", teamPermissionSchema);
const projectPermissionCreatedWebhookEvent = historicalEvent("project_permission.created", projectPermissionSchema);
const projectPermissionDeletedWebhookEvent = historicalEvent("project_permission.deleted", projectPermissionSchema);

/**
 * Hexclave webhook catalog, keyed by wire type.
 *
 * The event objects (type + yup schema) are Hexclave's own, the ones its
 * backend passes to Svix. Their `type` fields are typed `string`, so the keys
 * here supply the literal types, and module load asserts each key equals its
 * event's `type`. tests/hexclave-webhook-events.test.ts asserts the key set equals
 * Hexclave's `workflowPlatformEventTypes`, so an event added upstream fails a
 * test instead of being silently ignored.
 */
export const hexclaveWebhookCatalog = {
  "user.created": userCreatedWebhookEvent,
  "user.updated": userUpdatedWebhookEvent,
  "user.deleted": userDeletedWebhookEvent,
  "team.created": teamCreatedWebhookEvent,
  "team.updated": teamUpdatedWebhookEvent,
  "team.deleted": teamDeletedWebhookEvent,
  "team_membership.created": teamMembershipCreatedWebhookEvent,
  "team_membership.deleted": teamMembershipDeletedWebhookEvent,
  "team_permission.created": teamPermissionCreatedWebhookEvent,
  "team_permission.deleted": teamPermissionDeletedWebhookEvent,
  "project_permission.created": projectPermissionCreatedWebhookEvent,
  "project_permission.deleted": projectPermissionDeletedWebhookEvent,
} as const;

for (const [key, event] of Object.entries(hexclaveWebhookCatalog)) {
  if (event.type !== key) throw new Error(`Hexclave webhook catalog key ${key} names event ${event.type}`);
}

type Catalog = typeof hexclaveWebhookCatalog;
export type HexclaveWebhookEventType = keyof Catalog;

/** The validated `data` of one event type, inferred from Hexclave's schema. */
export type HexclaveWebhookData<T extends HexclaveWebhookEventType> = InferType<Catalog[T]["schema"]>;

/** Discriminated union of every validated Hexclave webhook body. */
export type HexclaveWebhookEvent = {
  [T in HexclaveWebhookEventType]: { readonly type: T; readonly data: HexclaveWebhookData<T> };
}[HexclaveWebhookEventType];

export const hexclaveWebhookEventTypes = Object.keys(hexclaveWebhookCatalog) as readonly HexclaveWebhookEventType[];

export function isHexclaveWebhookEventType(type: string): type is HexclaveWebhookEventType {
  return Object.hasOwn(hexclaveWebhookCatalog, type);
}

/**
 * Validation options for every Hexclave payload, webhook or API read.
 *
 * `strict` turns off casting, so a value is accepted only as Hexclave's schema
 * declares it ("1" is not a number, a trimmed string is not trimmed for us).
 * `abortEarly: false` reports every failing path. Unknown keys are kept, not
 * rejected: Hexclave adds fields without a version bump, and rejecting them
 * would turn every upstream addition into a webhook outage.
 */
export const HEXCLAVE_VALIDATE_OPTIONS = { strict: true, abortEarly: false } as const;

export type HexclaveValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Validate `value` against a Hexclave yup schema, never throwing on a schema mismatch. */
export async function validateHexclave<S extends ISchema<unknown>>(
  schema: S,
  value: unknown,
): Promise<HexclaveValidation<InferType<S>>> {
  try {
    return { ok: true, value: (await schema.validate(value, HEXCLAVE_VALIDATE_OPTIONS)) as InferType<S> };
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, errors: validationErrorPaths(error) };
    throw error;
  }
}

/**
 * `path: rule` for each failure, never yup's message: messages can interpolate
 * the rejected value (an email, a metadata blob), and these strings are logged.
 */
function validationErrorPaths(error: ValidationError): readonly string[] {
  const failures = error.inner.length > 0 ? error.inner : [error];
  return failures.slice(0, 20).map((failure) => `${failure.path || "(root)"}: ${failure.type ?? "invalid"}`);
}

export type ParsedHexclaveWebhook =
  | { readonly kind: "event"; readonly event: HexclaveWebhookEvent }
  | { readonly kind: "unknown"; readonly eventType: string }
  | { readonly kind: "invalid"; readonly eventType: string | null; readonly errors: readonly string[] };

/**
 * Parse and validate a Svix-verified body (`{ type, data }`, as Hexclave's
 * `sendWebhooks` builds it). A known type is accepted only when `data` passes
 * that type's Hexclave schema; an unknown type is reported, not guessed at.
 */
export async function parseHexclaveWebhook(rawBody: string): Promise<ParsedHexclaveWebhook> {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { kind: "invalid", eventType: null, errors: ["body is not JSON"] };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { kind: "invalid", eventType: null, errors: ["body is not an object"] };
  }
  const envelope = body as { readonly type?: unknown; readonly data?: unknown };
  if (typeof envelope.type !== "string" || !envelope.type) {
    return { kind: "invalid", eventType: null, errors: ["type must be a non-empty string"] };
  }
  const eventType = envelope.type.slice(0, 128);
  if (!isHexclaveWebhookEventType(envelope.type)) return { kind: "unknown", eventType };
  if (envelope.data === undefined || envelope.data === null) {
    return { kind: "invalid", eventType, errors: ["data is required"] };
  }
  return validateEvent(envelope.type, envelope.data);
}

async function validateEvent<T extends HexclaveWebhookEventType>(
  type: T,
  data: unknown,
): Promise<ParsedHexclaveWebhook> {
  const result = await validateHexclave(hexclaveWebhookCatalog[type].schema, data);
  if (!result.ok) return { kind: "invalid", eventType: type, errors: result.errors };
  // `type` and `result.value` come from the same catalog entry, so this pair is
  // exactly one member of the union. TypeScript cannot correlate a generic key
  // with a mapped union member, hence the single widening cast.
  return { kind: "event", event: { type, data: result.value } as HexclaveWebhookEvent };
}
