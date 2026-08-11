// Resolve hook implementation. See ts-resolve-hook.mjs for why this exists.
export async function resolve(specifier, context, nextResolve) {
  // `server-only` is a Next bundler alias, not an installed package. Test scripts run server
  // modules in Node, which is the context the guard allows, so it resolves to an empty module.
  if (specifier === "server-only") return { url: new URL("./server-only-stub.mjs", import.meta.url).href, shortCircuit: true };
  // `next/headers` and `next/navigation` only resolve inside the Next runtime. The stub exports
  // the same names so modules mixing request helpers with pure functions stay importable.
  if (specifier === "next/headers" || specifier === "next/navigation") return { url: new URL("./next-runtime-stub.mjs", import.meta.url).href, shortCircuit: true };
  // The app imports JSON without an import attribute (the bundler allows it, plain Node does
  // not). Supply the attribute so test scripts can load modules that pull in JSON data.
  if (specifier.endsWith(".json")) {
    const resolved = await nextResolve(specifier, { ...context, importAttributes: { type: "json" } });
    return { ...resolved, importAttributes: { type: "json" } };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // Only rewrite extensionless relative imports; anything else keeps its original error.
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
