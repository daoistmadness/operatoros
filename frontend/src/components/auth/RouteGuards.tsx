import React from "react";
import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { UserRole } from "../../api/auth";
import { useAuth } from "../../context/AuthContext";

export function AuthLoading() {
  return <div role="status" className="flex min-h-screen items-center justify-center bg-slate-50 font-bold text-slate-500">Checking your session…</div>;
}

export function RequireAuth({ children }: { children?: ReactNode }) {
  const { loading, authenticated } = useAuth();
  const location = useLocation();
  if (loading) return <AuthLoading />;
  if (!authenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children ? <>{children}</> : <Outlet />;
}

export function AccessDenied() {
  return (
    <div role="alert" className="mx-auto mt-20 max-w-xl rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center">
      <h1 className="text-2xl font-black text-amber-900">Access denied</h1>
      <p className="mt-2 text-sm font-semibold text-amber-700">Your account does not have permission to open this administrative area.</p>
    </div>
  );
}

export function RequireRole({ role, children }: { role: UserRole; children: ReactNode }) {
  const { loading, user } = useAuth();
  if (loading) return <AuthLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <AccessDenied />;
  return <>{children}</>;
}

export function RequireCapability({ capability, children }: { capability: string; children: ReactNode }) {
  const { loading, user, can } = useAuth();
  if (loading) return <AuthLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!can(capability)) return <AccessDenied />;
  return <>{children}</>;
}
