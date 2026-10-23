export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".css")) {
    return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) {
    return { format: "module", source: "export default {};", shortCircuit: true };
  }
  const loaded = await nextLoad(url, context);
  // Vite supplies this module's build-time environment in the browser. Node
  // tests use an explicitly unconfigured Auth0 fixture, without browser globals.
  if (url.endsWith("/web/src/config/auth.ts") && loaded.source != null) {
    const fixture = JSON.stringify({ VITE_AUTH0_REDIRECT_URI: "https://leilei.test/" });
    return { ...loaded, source: String(loaded.source).replaceAll("import.meta.env", fixture) };
  }
  return loaded;
}
