import { Navigate } from "react-router-dom";

export default function WhatsAppConnect() {
  return <Navigate to="/dashboard/settings?section=contact#contact" replace />;
}
