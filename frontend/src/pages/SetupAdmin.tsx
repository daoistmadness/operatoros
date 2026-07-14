import React, { useRef, useState } from "react";
import { Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useProvisionFirstAdminMutation } from "../hooks/useSetupQueries";
import { queryKeys } from "../lib/query/queryKeys";
import { useQueryClient } from "@tanstack/react-query";

type SetupAdminProps = { setupTokenRequired: boolean };

function errorCode(error: unknown): string | undefined {
  return (error as { data?: { detail?: { code?: string } } })?.data?.detail?.code;
}

export default function SetupAdmin({ setupTokenRequired }: SetupAdminProps) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const mutation = useProvisionFirstAdminMutation();
  const usernameRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mutation.isPending) return;
    setValidationError("");
    if (!username.trim()) {
      setValidationError("Enter an administrator username.");
      usernameRef.current?.focus();
      return;
    }
    if (password.length < 12) {
      setValidationError("Password must be at least 12 characters long.");
      return;
    }
    if (password !== confirmation) {
      setValidationError("Password confirmation does not match.");
      return;
    }
    try {
      await mutation.mutateAsync({
        username: username.trim(),
        password,
        password_confirmation: confirmation,
        ...(setupTokenRequired ? { setup_token: setupToken } : {}),
      });
      setPassword("");
      setConfirmation("");
      setSetupToken("");
      window.sessionStorage.setItem("astryx:login-notice", "Administrator created. Sign in with your new account.");
      navigate("/login", { replace: true });
    } catch (error) {
      const code = errorCode(error);
      if (code === "SETUP_ALREADY_COMPLETED") {
        await client.invalidateQueries({ queryKey: queryKeys.setup.all });
        navigate("/login", { replace: true });
        return;
      }
      if (code === "SETUP_TOKEN_REQUIRED" || code === "SETUP_TOKEN_INVALID") {
        setValidationError("The setup token is missing or invalid.");
      } else if (code === "PASSWORD_POLICY_FAILED") {
        setValidationError("Password must be at least 12 characters long.");
      } else {
        setValidationError("Administrator provisioning could not be completed. Please retry.");
      }
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white p-8 shadow-2xl" aria-labelledby="setup-title">
        <div className="mb-7 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-white"><ShieldCheck className="h-7 w-7" /></div>
          <div><p className="text-xs font-black uppercase tracking-[0.2em] text-brand">Astryx first run</p><h1 id="setup-title" className="text-2xl font-black text-slate-900">Create administrator</h1></div>
        </div>
        <p className="mb-6 text-sm text-slate-600">Create the first local administrator. Setup closes permanently afterward, and you will sign in normally.</p>
        {validationError && <div role="alert" tabIndex={-1} className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{validationError}</div>}
        <form onSubmit={submit} className="space-y-5">
          <label className="block text-sm font-bold text-slate-700">Administrator username
            <span className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 px-4 focus-within:border-brand"><UserRound className="h-5 w-5 text-slate-400" /><input ref={usernameRef} aria-label="Administrator username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className="w-full bg-transparent py-3 outline-none" required /></span>
          </label>
          <label className="block text-sm font-bold text-slate-700">Password
            <span className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 px-4 focus-within:border-brand"><LockKeyhole className="h-5 w-5 text-slate-400" /><input aria-label="Password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full bg-transparent py-3 outline-none" required /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button></span>
          </label>
          <p className="-mt-3 text-xs text-slate-500">Use at least 12 characters.</p>
          <label className="block text-sm font-bold text-slate-700">Confirm password
            <input aria-label="Confirm password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-brand" required />
          </label>
          {setupTokenRequired && <label className="block text-sm font-bold text-slate-700">Deployment setup token
            <input aria-label="Deployment setup token" type="password" autoComplete="off" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-brand" required />
          </label>}
          <button type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending} className="w-full rounded-xl bg-brand px-5 py-3.5 font-black text-white shadow-lg shadow-brand/20 disabled:cursor-not-allowed disabled:opacity-60">{mutation.isPending ? "Creating administrator…" : "Create administrator"}</button>
        </form>
      </section>
    </main>
  );
}
