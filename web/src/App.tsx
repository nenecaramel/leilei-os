import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ProtectedApp } from "./auth/ProtectedApp";
import { AppShell } from "./layout/AppShell";
import { DashboardPage } from "./pages/DashboardPageContainer";
import { DiaryPage } from "./pages/DiaryPageContainer";
import { MemoryPage } from "./pages/MemoryPageContainer";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TaskPage } from "./pages/TaskPageContainer";
import { GlobalSearchPage } from "./pages/GlobalSearchPageContainer";

export default function App() {
  return (
    <BrowserRouter>
      <ProtectedApp>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />

            <Route
              path="memory"
              element={<MemoryPage />}
            />

            <Route
              path="diary"
              element={<DiaryPage />}
            />

            <Route
              path="task"
              element={<TaskPage />}
            />

            <Route path="search" element={<GlobalSearchPage />} />

            <Route
              path="settings"
              element={<SettingsPage />}
            />

            <Route
              path="chat-archive"
              element={<PlaceholderPage title="Chat Archive" />}
            />

            <Route
              path="universe"
              element={<PlaceholderPage title="Universe" />}
            />
          </Route>
        </Routes>
      </ProtectedApp>
    </BrowserRouter>
  );
}
