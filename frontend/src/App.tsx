import { Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoginPage } from "@/pages/auth/LoginPage";
import { RegisterPage } from "@/pages/auth/RegisterPage";
import { WorkspaceProvider } from "@/providers/WorkspaceProvider";

const OverviewPage = lazy(() =>
  import("@/pages/OverviewPage").then((module) => ({ default: module.OverviewPage })),
);
const RequestsPage = lazy(() =>
  import("@/pages/RequestsPage").then((module) => ({ default: module.RequestsPage })),
);
const WebhooksPage = lazy(() =>
  import("@/pages/WebhooksPage").then((module) => ({ default: module.WebhooksPage })),
);
const JobsPage = lazy(() =>
  import("@/pages/JobsPage").then((module) => ({ default: module.JobsPage })),
);
const IncidentsPage = lazy(() =>
  import("@/pages/IncidentsPage").then((module) => ({ default: module.IncidentsPage })),
);
const EndpointsPage = lazy(() =>
  import("@/pages/EndpointsPage").then((module) => ({ default: module.EndpointsPage })),
);
const EnvironmentsPage = lazy(() =>
  import("@/pages/EnvironmentsPage").then((module) => ({ default: module.EnvironmentsPage })),
);
const SecretsPage = lazy(() =>
  import("@/pages/SecretsPage").then((module) => ({ default: module.SecretsPage })),
);
const ApiKeysPage = lazy(() =>
  import("@/pages/ApiKeysPage").then((module) => ({ default: module.ApiKeysPage })),
);
const AuditPage = lazy(() =>
  import("@/pages/AuditPage").then((module) => ({ default: module.AuditPage })),
);
const SettingsPage = lazy(() =>
  import("@/pages/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const NotFoundPage = lazy(() =>
  import("@/pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })),
);

function PageFallback() {
  return (
    <div className="space-y-5 p-6 lg:p-8">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-[420px] w-full" />
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
      <Route element={<LoginPage />} path="/login" />
      <Route element={<RegisterPage />} path="/register" />
      <Route
        element={
          <ProtectedRoute>
            <WorkspaceProvider>
              <AppShell />
            </WorkspaceProvider>
          </ProtectedRoute>
        }
      >
        <Route element={<OverviewPage />} index />
        <Route element={<RequestsPage />} path="requests" />
        <Route element={<WebhooksPage />} path="webhooks" />
        <Route element={<WebhooksPage />} path="webhooks/:eventId" />
        <Route element={<JobsPage />} path="jobs" />
        <Route element={<JobsPage />} path="jobs/:jobId" />
        <Route element={<IncidentsPage />} path="incidents" />
        <Route element={<IncidentsPage />} path="incidents/:incidentId" />
        <Route element={<EndpointsPage />} path="endpoints" />
        <Route element={<EnvironmentsPage />} path="environments" />
        <Route element={<SecretsPage />} path="secrets" />
        <Route element={<ApiKeysPage />} path="api-keys" />
        <Route element={<AuditPage />} path="audit" />
        <Route element={<SettingsPage />} path="settings" />
        <Route element={<NotFoundPage />} path="*" />
      </Route>
      </Routes>
    </Suspense>
  );
}
