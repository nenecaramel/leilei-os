import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ProtectedApp } from "./auth/ProtectedApp";
import {
  ArchiveIcon,
  UniverseIcon,
} from "./components/icons";
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
              element={
                <PlaceholderPage
                  eyebrow="Conversation history"
                  title="Chat Archive"
                  description="用于未来整理重要对话与决策脉络。"
                  note="当前仅保留信息架构位置，不接入聊天历史。"
                  icon={<ArchiveIcon />}
                />
              }
            />

            <Route
              path="universe"
              element={
                <PlaceholderPage
                  eyebrow="Connected thinking"
                  title="Universe"
                  description="用于未来连接想法、项目与长期主题。"
                  note="当前仅为占位页面，不实现思维宇宙联动。"
                  icon={<UniverseIcon />}
                />
              }
            />
          </Route>
        </Routes>
      </ProtectedApp>
    </BrowserRouter>
  );
}
