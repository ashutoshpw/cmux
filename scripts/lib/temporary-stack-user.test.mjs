import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

// The Stack allocator no longer has a supported provider API. Keep one contract
// at its executable boundary: old callers cannot create upstream accounts.
test("the retired account allocator rejects provisioning and cleanup", () => {
  for (const command of ["create", "cleanup"]) {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("./temporary-stack-user.mjs", import.meta.url)), command,
    ], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Stack development accounts are retired/);
    assert.doesNotMatch(result.stderr, /ENOENT|secret|password=/);
  }
});
