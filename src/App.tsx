import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { lazy, Suspense } from "react";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./components/auth/LoginPage";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import NotFound from "./pages/NotFound";

// Heavy pages are lazy-loaded so the embed and other lightweight routes
// do not pay the cost of loading the admin/dashboard/results bundles.
const WorkflowInteractionPage = lazy(() => import("./pages/WorkflowInteractionPage"));
const StudioRuntimePage = lazy(() => import("./pages/StudioRuntimePage"));
const ChatComponentPage = lazy(() => import("./pages/ChatComponentPage"));
const ApplicationPreviewPage = lazy(() => import("./pages/ApplicationPreviewPage"));
const OrgGateway = lazy(() => import("./pages/OrgEntryPage"));
const AdminDashboard = lazy(() => import("./components/admin/AdminDashboard"));
const EmbedGateway = lazy(() => import("./components/embed/EmbedGateway"));
const DebugModePage = lazy(() => import("./pages/DebugModePage"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Suspense>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/debug"
                element={
                  <ProtectedRoute>
                    <DebugModePage />
                  </ProtectedRoute>
                }
              />
              <Route path="/" element={<LandingPage />} />
              <Route path="/embed" element={<EmbedGateway />} />
              <Route path="/workflow/respond" element={<WorkflowInteractionPage />} />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />
              <Route path="/admin/application-preview/:organizationId" element={<ProtectedRoute requireAdmin><ApplicationPreviewPage /></ProtectedRoute>} />
              <Route path="/o/:orgSlug/apps/:appSlug" element={<ProtectedRoute><StudioRuntimePage /></ProtectedRoute>} />
              <Route path="/o/:orgSlug/apps/:appSlug/:pageSlug" element={<ProtectedRoute><StudioRuntimePage /></ProtectedRoute>} />
              <Route path="/o/:orgSlug/canvas/:canvasSlug" element={<ProtectedRoute><StudioRuntimePage canvas /></ProtectedRoute>} />
              <Route path="/o/:orgSlug/chat/:chatId" element={<ProtectedRoute><ChatComponentPage /></ProtectedRoute>} />
              <Route path="/chat/embed/:orgSlug/:chatId" element={<ChatComponentPage embedded />} />
              {/* Organization-specific gateway route */}
              <Route path="/:slug" element={<OrgGateway />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
