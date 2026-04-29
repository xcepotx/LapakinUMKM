import "@/App.css";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/sonner";

import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import AuthCallback from "@/pages/AuthCallback";
import Onboarding from "@/pages/Onboarding";
import Dashboard from "@/pages/Dashboard";
import AIStudio from "@/pages/AIStudio";
import Products from "@/pages/Products";
import ShopSettings from "@/pages/ShopSettings";
import WhatsAppConnect from "@/pages/WhatsAppConnect";
import Storefront from "@/pages/Storefront";

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
  // Synchronous check for OAuth session_id BEFORE rendering routes
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
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
      <Route path="/toko/:slug" element={<Storefront />} />
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
