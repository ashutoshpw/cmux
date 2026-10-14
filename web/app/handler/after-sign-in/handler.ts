import { NextRequest, NextResponse } from "next/server";
import { applicationOrigin } from "../../../services/deployment/origin";
type User = {
  id: string;
  primaryEmail: string | null;
  primaryEmailVerified: boolean;
  isAnonymous: boolean;
};
type Dependencies = {
  getUser(request: NextRequest): Promise<User | null>;
  claimVerifiedBilling(userId: string): Promise<void>;
  applyAdminGrants(userId: string, email: string): Promise<void>;
};
/** Auth completion never puts reusable credentials in a browser destination. */
export function makeAfterSignInHandler(dependencies: Dependencies) {
  return async function GET(request: NextRequest): Promise<NextResponse> {
    const user = await dependencies.getUser(request);
    if (!user)
      return NextResponse.redirect(
        new URL("/handler/sign-in", applicationOrigin()),
      );
    if (user.primaryEmailVerified && !user.isAnonymous && user.primaryEmail) {
      await dependencies.claimVerifiedBilling(user.id);
      await dependencies.applyAdminGrants(user.id, user.primaryEmail);
    }
    const target = request.nextUrl.searchParams.get("after_auth_return_to");
    const path =
      target?.startsWith("/") &&
      !target.startsWith("//") &&
      !target.includes("\\")
        ? target
        : "/dashboard";
    return NextResponse.redirect(new URL(path, applicationOrigin()));
  };
}
