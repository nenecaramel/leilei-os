import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppAuthProvider } from "./auth/AuthProvider";
import "./styles.css";
import "./pages/lg-author-editor-layout-fix.css";
import "./pages/home-calendar-real-data.css";
import "./pages/system-export-ui-polish.css";
import "./pages/universe/universe-node-detail-memory-shell.css";
import "./pages/universe-detail-dayspace-header-polish.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppAuthProvider>
      <App />
    </AppAuthProvider>
  </StrictMode>,
);
