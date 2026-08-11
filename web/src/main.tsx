import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppAuthProvider } from "./auth/AuthProvider";
import "./styles.css";
import "./pages/lg-author-editor-layout-fix.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppAuthProvider>
      <App />
    </AppAuthProvider>
  </StrictMode>,
);
