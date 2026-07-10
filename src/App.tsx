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
const OrgGateway = lazy(() => import("./pages/OrgGateway"));
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
              <Route
                path="/admin"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />
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
