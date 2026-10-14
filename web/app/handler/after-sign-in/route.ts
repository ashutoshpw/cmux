import { getStackServerApp } from "../../lib/stack";
import { claimPendingProBilling } from "../../../services/billing/purchase";
import { applyPendingEmailGrants } from "../../../services/admin/proGrants";
import { makeAfterSignInHandler } from "./handler";
export const GET = makeAfterSignInHandler({
  getUser: (request) =>
    getStackServerApp().getUser({ tokenStore: request, or: "return-null" }),
  claimVerifiedBilling: async (userId) => {
    const user = await getStackServerApp().getUser(userId);
    if (user) await claimPendingProBilling(user);
  },
  applyAdminGrants: (id, primaryEmail) =>
    applyPendingEmailGrants({ id, primaryEmail }).then(() => undefined),
});
