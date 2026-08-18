import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppAuthProvider } from "./auth/AuthProvider";
import { startPwaRegistration } from "./pwa/register-pwa";
import "./styles.css";
import "./pwa/pwa-status.css";
import "./pages/lg-author-editor-layout-fix.css";
import "./pages/home-calendar-real-data.css";
import "./pages/system-export-ui-polish.css";
import "./pages/system-restore-ui-polish.css";
import "./pages/universe/universe-node-detail-memory-shell.css";
import "./pages/universe-detail-dayspace-header-polish.css";
import "./pages/universe-mobile-final-geometry.css";
import "./pages/universe-home-dark.css";
import "./pages/universe-home-dark-production-fixes.css";

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
