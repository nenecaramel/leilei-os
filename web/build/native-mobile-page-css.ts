import type { Plugin } from "vite";
import { extractNativeMobileDesktopCss } from "./native-mobile-css-transform";
export { extractNativeMobileDesktopCss, mirrorNativeMobilePageCss } from "./native-mobile-css-transform";

const DESKTOP_QUERY = "native-mobile-desktop";

export function nativeMobilePageCssPlugin(): Plugin {
  return {
    name: "leilei-native-mobile-page-css",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes(`?${DESKTOP_QUERY}`) && !id.includes(`&${DESKTOP_QUERY}`)) {
        return null;
      }
      const cleanId = id.split("?", 1)[0];
      if (!cleanId.endsWith(".css") || !cleanId.includes("/web/src/")) return null;
      return { code: extractNativeMobileDesktopCss(code), map: null };
    },
  };
}
