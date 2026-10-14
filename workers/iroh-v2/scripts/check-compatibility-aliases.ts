type Settings = { bindings: { name: string; type: string; service?: string; class_name?: string }[] };

export function assertAliasSafe(canonical: Settings, alias: Settings | null, target: string): void {
  for (const className of ["TeamControl", "UserUsage"]) {
    if (!canonical.bindings.some(binding => binding.type === "durable_object_namespace" && binding.class_name === className)) {
      throw new Error(`${target} is missing its ${className} storage binding`);
    }
  }
  if (alias !== null && (alias.bindings.length !== 1
    || alias.bindings[0]?.type !== "service"
    || alias.bindings[0]?.name !== "CANONICAL"
    || alias.bindings[0]?.service !== target)) {
    throw new Error("Old Worker is not an existing compatibility alias; rename it in place before deploying aliases");
  }
}

if (import.meta.main) {
  console.error("Upstream compatibility alias deployment is retired in the owned fork");
  process.exitCode = 1;
}
