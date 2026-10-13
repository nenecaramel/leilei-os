import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import * as React from "../../web/node_modules/react/index.js";
import { createRoot } from "../../web/node_modules/react-dom/client.js";

export type AuthState = {
  isLoading: boolean; isAuthenticated: boolean; error?: Error;
  loginWithPopup(): Promise<void>; loginWithRedirect(): Promise<void>;
};

// Production components are compiled unchanged; replace only the network SDK
// and build configuration. Platform detection, handlers and effects stay real.
export async function loadAuthComponents(config: unknown = {
  domain: "auth.example", clientId: "client", redirectUri: "https://leilei.test/",
  audience: "api", scope: "read:diary",
}) {
  const directory = await mkdtemp(join(tmpdir(), "auth-components-"));
  try {
    const output = join(directory, "components.mjs");
    const result = await build({
      stdin: {
        contents: 'export { ProtectedApp } from "./web/src/auth/ProtectedApp"; export { AppAuthProvider } from "./web/src/auth/AuthProvider";',
        resolveDir: resolve("."), loader: "ts",
      },
      bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
      plugins: [{ name: "auth-boundaries", setup(builder) {
        builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({
          path: resolve("web/node_modules", path === "react" ? "react/index.js" : `${path}.js`), external: true,
        }));
        builder.onResolve({ filter: /^@auth0\/auth0-react$/ }, () => ({ path: "sdk", namespace: "auth-test" }));
        builder.onResolve({ filter: /config\/auth$/ }, () => ({ path: "config", namespace: "auth-test" }));
        builder.onLoad({ filter: /.*/, namespace: "auth-test" }, ({ path }) => ({
          contents: path === "config" ? `export const authConfig = ${JSON.stringify(config)};` : `
            import { createElement } from "react";
            export function useAuth0() { return globalThis.__authTestState; }
            export function Auth0Provider(props) {
              globalThis.__authTestProviderProps = props;
              return createElement("div", { "data-auth-provider": true }, props.children);
            }
          `, loader: "js",
        }));
      } }],
    });
    await writeFile(output, result.outputFiles[0].text);
    return await import(pathToFileURL(output).href) as {
      ProtectedApp: React.ComponentType<React.PropsWithChildren>;
      AppAuthProvider: React.ComponentType<React.PropsWithChildren>;
    };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function mountAuth(component: React.ComponentType<React.PropsWithChildren>, options: {
  displayMode?: boolean; iosStandalone?: boolean; auth?: AuthState;
} = {}) {
  const dom = new JSDOM('<meta name="theme-color" content="#123456"><div id="root"></div>', { url: "https://leilei.test/" });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true, __authTestState: options.auth, __authTestProviderProps: undefined,
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.matchMedia = (query) => {
    if (query !== "(display-mode: standalone)") throw new Error(`Unexpected media query: ${query}`);
    return { matches: options.displayMode ?? false } as MediaQueryList;
  };
  Object.defineProperty(dom.window.navigator, "standalone", { value: options.iosStandalone });
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const render = async () => React.act(async () => {
    root.render(React.createElement(component, {}, React.createElement("p", { "data-private-child": true }, "Private workspace")));
  });
  await render();
  return {
    dom, container,
    providerProps: () => (globalThis as any).__authTestProviderProps as Record<string, any> | undefined,
    async updateAuth(auth: AuthState) { (globalThis as any).__authTestState = auth; await render(); },
    async clickLogin() {
      const button = container.querySelector("button");
      if (!button) throw new Error("Login action missing");
      await React.act(async () => { button.click(); });
    },
    async cleanup() {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of prior) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}
