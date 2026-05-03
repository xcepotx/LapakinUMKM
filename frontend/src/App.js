import "@/App.css";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/sonner";

import SalesBook from "./pages/SalesBook";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Onboarding from "@/pages/Onboarding";
import Dashboard from "@/pages/Dashboard";
import AIStudio from "@/pages/AIStudio";
import Products from "@/pages/Products";
import ShopSettings from "@/pages/ShopSettings";
import ShopQR from "@/pages/ShopQR";
import WhatsAppConnect from "@/pages/WhatsAppConnect";
import Storefront from "@/pages/Storefront";
import Pricing from "@/pages/Pricing";
import Billing from "@/pages/Billing";
import Analytics from "@/pages/Analytics";
import Cerita from "@/pages/Cerita";
import CeritaDetail from "@/pages/CeritaDetail";
import ContentStudio from "@/pages/ContentStudio";
import DailyMenu from "@/pages/DailyMenu";

import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminShops from "@/pages/admin/AdminShops";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminProducts from "@/pages/admin/AdminProducts";
import AdminBroadcasts from "@/pages/admin/AdminBroadcasts";
import AdminAIUsage from "@/pages/admin/AdminAIUsage";
import AdminAudit from "@/pages/admin/AdminAudit";
import AdminStories from "@/pages/admin/AdminStories";
import AdminHealth from "@/pages/admin/AdminHealth";

import { detectTenantSlug } from "@/lib/tenant";

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="min-h-screen grid place-items-center text-brand-mute">Memeriksa akses…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return children;
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-sand">
        <div className="text-brand-mute" data-testid="auth-loading">Memeriksa sesi…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRouter() {
  const location = useLocation();
  const tenantSlug = detectTenantSlug();
  // Synchronous check for OAuth session_id BEFORE rendering routes
 
  return (
    <Routes>
      {/* Tenant subdomain root: <slug>.lapakin.my.id/ → load that shop's storefront */}
      {tenantSlug ? (
        <Route path="/" element={<Storefront tenantSlug={tenantSlug} />} />
      ) : (
        <Route path="/" element={<Landing />} />
      )}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
      <Route path="/dashboard/ai-studio" element={<ProtectedRoute><AIStudio /></ProtectedRoute>} />
      <Route path="/dashboard/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
      <Route path="/dashboard/whatsapp" element={<ProtectedRoute><WhatsAppConnect /></ProtectedRoute>} />
      <Route path="/dashboard/settings" element={<ProtectedRoute><ShopSettings /></ProtectedRoute>} />
      <Route path="/dashboard/qr" element={<ProtectedRoute><ShopQR /></ProtectedRoute>} />
      <Route path="/dashboard/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
      <Route path="/dashboard/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
      <Route path="/dashboard/content-studio" element={<ProtectedRoute><ContentStudio /></ProtectedRoute>} />
      <Route path="/dashboard/daily-menu" element={<ProtectedRoute><DailyMenu /></ProtectedRoute>} />
      <Route path="/dashboard/sales" element={<SalesBook />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/cerita" element={<Cerita />} />
      <Route path="/cerita/:slug" element={<CeritaDetail />} />
      <Route path="/toko/:slug" element={<Storefront />} />
      <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
      <Route path="/admin/shops" element={<AdminRoute><AdminShops /></AdminRoute>} />
      <Route path="/admin/users" element={<AdminRoute><AdminUsers /></AdminRoute>} />
      <Route path="/admin/products" element={<AdminRoute><AdminProducts /></AdminRoute>} />
      <Route path="/admin/broadcasts" element={<AdminRoute><AdminBroadcasts /></AdminRoute>} />
      <Route path="/admin/ai-usage" element={<AdminRoute><AdminAIUsage /></AdminRoute>} />
      <Route path="/admin/audit" element={<AdminRoute><AdminAudit /></AdminRoute>} />
      <Route path="/admin/stories" element={<AdminRoute><AdminStories /></AdminRoute>} />
      <Route path="/admin/health" element={<AdminRoute><AdminHealth /></AdminRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <AppRouter />
          <Toaster richColors position="top-center" />
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
