import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Sidebar } from "./components/Sidebar";
import { TopRibbon, ToastStack } from "./components/TopRibbon";
import { SetupGate } from "./components/SetupGate";
import { DashboardPage } from "./pages/DashboardPage";
import { HistoryPage } from "./pages/HistoryPage";
import { PrunePage } from "./pages/PrunePage";
import { AuditPage } from "./pages/AuditPage";
import { DoctorPage } from "./pages/DoctorPage";
import { UsersPage } from "./pages/UsersPage";
import { SessionsPage } from "./pages/SessionsPage";
import { ActivityPage } from "./pages/ActivityPage";
import { useRouteStore } from "./stores/route-store";
import { useThemeStore } from "./stores/theme-store";

function App() {
  const section = useRouteStore((s) => s.route.section);
  const initRoute = useRouteStore((s) => s.init);
  const initTheme = useThemeStore((s) => s.init);

  // Both subscribe to browser-level events (hashchange, prefers-color-scheme)
  // and return their own teardown.
  useEffect(() => initRoute(), [initRoute]);
  useEffect(() => initTheme(), [initTheme]);

  const content = {
    overview: <DashboardPage />,
    history: <HistoryPage />,
    prune: <PrunePage />,
    audit: <AuditPage />,
    doctor: <DoctorPage />,
    users: <UsersPage />,
    sessions: <SessionsPage />,
    activity: <ActivityPage />,
  }[section];

  return (
    <SetupGate>
      <div className="flex min-h-screen bg-surface text-ink">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <TopRibbon />
          <main className="flex-1 overflow-auto">{content}</main>
        </div>
      </div>
      <ToastStack />
    </SetupGate>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(<App />);
}
