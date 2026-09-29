import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppAuthProvider } from "./auth/AuthProvider";
import { startPwaRegistration } from "./pwa/register-pwa";
import { installUniverseSourcePickerAutoReveal } from "./pages/universe/source-picker-auto-reveal";
import "./styles.css";
import "./desktop-foundation.css";
import "./layout/navigation-panel.css";
import "./pwa/pwa-status.css";
import "./pages/lg-author-editor-layout-fix.css";
import "./pages/home-calendar-real-data.css";
import "./pages/system-data-backup.css";
import "./pages/universe/universe-node-detail-memory-shell.css";
import "./pages/universe-detail-dayspace-header-polish.css";
import "./pages/universe-mobile-final-geometry.css";
import "./pages/universe-home-dark.css";
import "./pages/universe-home-dark-production-fixes.css";

/*
 * Desktop gets the actual accepted mobile declarations from these same source
 * files, emitted by the Vite plugin after the desktop foundation. This is not a
 * second desktop theme; mobile remains the single presentation source.
 */
import "./styles.css?native-mobile-desktop";
import "./pages/lg-author-editor-layout-fix.css?native-mobile-desktop";
import "./pages/universe/universe-node-detail-memory-shell.css?native-mobile-desktop";
import "./pages/universe-detail-dayspace-header-polish.css?native-mobile-desktop";
import "./pages/universe-mobile-final-geometry.css?native-mobile-desktop";
import "./pages/universe-home-dark.css?native-mobile-desktop";
import "./pages/universe-home-dark-production-fixes.css?native-mobile-desktop";
import "./pages/universe-state-polish.css?native-mobile-desktop";
import "./native-mobile-desktop-geometry.css";

installUniverseSourcePickerAutoReveal();

if (import.meta.env.PROD) {
  startPwaRegistration();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppAuthProvider>
      <App />
    </AppAuthProvider>
  </StrictMode>,
);
