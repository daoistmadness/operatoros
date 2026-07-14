import React, { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { LockKeyhole, LogIn, UserRound } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { authenticated, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const destination = (location.state as { from?: string } | null)?.from || "/";
  const notice = (location.state as { message?: string } | null)?.message || window.sessionStorage.getItem("astryx:login-notice");
  useEffect(() => { window.sessionStorage.removeItem("astryx:login-notice"); }, []);

  if (!loading && authenticated) return <Navigate to={destination} replace />;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    const submittedPassword = password;
    setPassword("");
    try {
      await login(username.trim(), submittedPassword);
      navigate(destination, { replace: true });
    } catch (_error) {
      setError("Invalid username or password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white p-8 shadow-2xl" aria-labelledby="login-title">
        <div className="mb-8 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-2xl font-black text-white">A</div>
          <div><p className="text-xs font-black uppercase tracking-[0.2em] text-brand">Astryx</p><h1 id="login-title" className="text-2xl font-black text-slate-900">Sign in</h1></div>
        </div>
        <p className="mb-6 text-sm text-slate-500">Use your local Astryx account to continue.</p>
        {notice && <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</div>}
        {error && <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block text-sm font-bold text-slate-700">Username
            <span className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 px-4 focus-within:border-brand"><UserRound className="h-5 w-5 text-slate-400" /><input aria-label="Username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className="w-full bg-transparent py-3 outline-none" required /></span>
          </label>
          <label className="block text-sm font-bold text-slate-700">Password
            <span className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 px-4 focus-within:border-brand"><LockKeyhole className="h-5 w-5 text-slate-400" /><input aria-label="Password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full bg-transparent py-3 outline-none" required /></span>
          </label>
          <button type="submit" disabled={submitting || loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3.5 font-black text-white shadow-lg shadow-brand/20 disabled:cursor-not-allowed disabled:opacity-60"><LogIn className="h-5 w-5" />{submitting ? "Signing in…" : "Sign in"}</button>
        </form>
      </section>
    </main>
  );
}
