/**
 * Generated from config/iroh/managed-relay-catalog.json.
 *
 * Fleet rotations are add-before-remove. Bump sequence and add first, deploy
 * both server consumers, wait one signed-policy lifetime, then bump sequence
 * again and remove. Run web/tools/generate-managed-iroh-relay-catalog.ts after
 * every edit. Signing keys and relay credentials never belong in this file.
 */
export const MANAGED_IROH_RELAY_CATALOG: {
  readonly version: 1;
  readonly sequence: number;
  readonly relays: readonly { readonly id: string; readonly provider: string; readonly region: string; readonly url: string }[];
} = {
  "version": 1,
  "sequence": 3,
  "relays": []
} as const;

/** Exact managed relay origins derived from the canonical catalog. */
export const MANAGED_IROH_RELAY_URLS = MANAGED_IROH_RELAY_CATALOG.relays.map(
  (relay: { readonly url: string }) => relay.url,
);
