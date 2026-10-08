import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import { ProtectedApp } from "./auth/ProtectedApp";
import { AppShell } from "./layout/AppShell";
import { DashboardPage } from "./pages/DashboardPageContainer";
import { DiaryPage } from "./pages/DiaryPageContainer";
import { GlobalSearchPage } from "./pages/GlobalSearchPageContainer";
import { SystemAboutPage } from "./pages/SystemAboutPage";
import { SystemAccountPage } from "./pages/SystemAccountPage";
import { SystemActivityPage } from "./pages/SystemActivityPage";
import { SystemConnectionsPage } from "./pages/SystemConnectionsPage";
import { SystemDataPage } from "./pages/SystemDataPage";
import { UniversePage } from "./pages/UniversePageContainer";

import { DaySpacePage } from "./pages/DaySpacePageContainer";
import { MindPage } from "./pages/MindPageContainer";
export default function App() {
  return (
    <BrowserRouter>
      <ProtectedApp>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />

            <Route path="mind" element={<MindPage />} />
            <Route path="diary" element={<DiaryPage />} />
            <Route path="day-space" element={<DaySpacePage />} />
            <Route path="search" element={<GlobalSearchPage />} />

            <Route
              path="system"
              element={<Navigate to="/system/account" replace />}
            />
            <Route
              path="settings"
              element={<Navigate to="/system/account" replace />}
            />

            <Route
              path="system/account"
              element={<SystemAccountPage />}
            />
            <Route
              path="system/connections"
              element={<SystemConnectionsPage />}
            />
            <Route
              path="system/data"
              element={<SystemDataPage />}
            />
            <Route
              path="system/activity"
              element={<SystemActivityPage />}
            />
            <Route
              path="system/about"
              element={<SystemAboutPage />}
            />

            <Route
              path="universe"
              element={<UniversePage />}
            />

            <Route
              path="*"
              element={<Navigate to="/" replace />}
            />
          </Route>
        </Routes>
      </ProtectedApp>
    </BrowserRouter>
  );
}
