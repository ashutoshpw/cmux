import { describe, expect, test } from "bun:test";
import { hasPasswordErrors, validatePasswordForm } from "../dashboard-app/screens/settings/lib/password";

describe("password form validation", () => {
  test("requires the old password only when one is set", () => {
    const values = { oldPassword: "", newPassword: "long-enough-password", newPasswordRepeat: "long-enough-password" };
    expect(validatePasswordForm(values, true)).toEqual({ oldPassword: "required" });
    expect(validatePasswordForm(values, false)).toEqual({});
  });

  test("applies the owned auth password length limits", () => {
    expect(validatePasswordForm({ oldPassword: "", newPassword: "short", newPasswordRepeat: "short" }, false))
      .toEqual({ newPassword: "tooShort" });
    const long = "x".repeat(129);
    expect(validatePasswordForm({ oldPassword: "", newPassword: long, newPasswordRepeat: long }, false))
      .toEqual({ newPassword: "tooLong" });
  });

  test("requires a matching repeat", () => {
    const errors = validatePasswordForm(
      { oldPassword: "", newPassword: "long-enough-password", newPasswordRepeat: "different" },
      false,
    );
    expect(errors).toEqual({ newPasswordRepeat: "mismatch" });
    expect(hasPasswordErrors(errors)).toBe(true);
    expect(hasPasswordErrors({})).toBe(false);
  });
});
