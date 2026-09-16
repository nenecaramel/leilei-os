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
import { MemoryPage } from "./pages/MemoryPageContainer";
import { SystemAboutPage } from "./pages/SystemAboutPage";
import { SystemAccountPage } from "./pages/SystemAccountPage";
import { SystemActivityPage } from "./pages/SystemActivityPage";
import { SystemConnectionsPage } from "./pages/SystemConnectionsPage";
import { SystemDataPage } from "./pages/SystemDataPage";
import { TaskPage } from "./pages/TaskPageContainer";
import { UniversePage } from "./pages/UniversePageContainer";
import { SentinelPage } from "./pages/SentinelPageContainer";
import { SharedPaperPage } from "./pages/SharedPaperPageContainer";
import { ConversationArchivePage } from "./pages/ConversationArchivePageContainer";

import { DaySpacePage } from "./pages/DaySpacePageContainer";
export default function App() {
  return (
    <BrowserRouter>
      <ProtectedApp>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />

            <Route path="memory" element={<MemoryPage />} />
            <Route path="diary" element={<DiaryPage />} />
            <Route path="shared-paper" element={<SharedPaperPage />} />
            <Route path="conversations" element={<ConversationArchivePage />} />
            <Route path="conversations/:conversationId" element={<ConversationArchivePage />} />
            <Route path="task" element={<TaskPage />} />
            <Route path="day-space" element={<DaySpacePage />} />
            <Route path="search" element={<GlobalSearchPage />} />
            <Route path="sentinel" element={<SentinelPage />} />

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
