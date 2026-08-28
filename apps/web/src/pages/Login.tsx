import React, { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, LockKeyhole, LogIn, UserRound } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "../components/ui/card";
import { FieldLabel, FormField } from "../components/ui/field";
import { FieldError } from "../components/ui/field-error";
import { Form } from "../components/ui/form";
import { Input } from "../components/ui/input";

export default function Login() {
  const { authenticated, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const destination = (location.state as { from?: string } | null)?.from || "/";
  const notice = (location.state as { message?: string } | null)?.message || window.sessionStorage.getItem("astryx:login-notice");
  useEffect(() => { window.sessionStorage.removeItem("astryx:login-notice"); }, []);

  if (!loading && authenticated) return <Navigate to={destination} replace />;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const validationErrors = {
      ...(!username.trim() && { username: "Username is required" }),
      ...(!password && { password: "Password is required" }),
    };
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
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
    <main className="flex min-h-screen items-start justify-center overflow-y-auto bg-slate-950 px-4 py-12">
      <Card className="my-auto w-full max-w-md rounded-3xl border-white/10 shadow-2xl" aria-labelledby="login-title">
        <CardHeader className="pb-4"><div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-2xl font-black text-white">O</div>
          <div><p className="text-xs font-black uppercase tracking-[0.2em] text-brand">OperatorOS</p><h1 id="login-title" className="text-2xl font-black tracking-tight">Sign in</h1></div>
        </div><CardDescription>Use your local OperatorOS account to continue.</CardDescription></CardHeader>
        <CardContent>
        {notice && <Alert variant="success" role="status" className="mb-5 font-bold">{notice}</Alert>}
        {error && <Alert variant="danger" className="mb-5 font-bold" aria-live="assertive">{error}. Check your details and try again.</Alert>}
        <Form onSubmit={handleSubmit}>
          <FormField id="username" required invalid={Boolean(fieldErrors.username)}><FieldLabel>Username</FieldLabel><div className="relative"><UserRound className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400" /><Input autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value); if (fieldErrors.username) setFieldErrors((current) => ({ ...current, username: undefined })); }} className="pl-10" /></div><FieldError>{fieldErrors.username}</FieldError></FormField>
          <FormField id="password" required invalid={Boolean(fieldErrors.password)}><FieldLabel>Password</FieldLabel><div className="relative"><LockKeyhole className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400" /><Input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value); if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: undefined })); }} className="px-10" /><button type="button" aria-label={showPassword ? "Hide login password" : "Show login password"} aria-pressed={showPassword} onClick={() => setShowPassword((shown) => !shown)} className="absolute right-1 top-1 inline-flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800">{showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}</button></div><FieldError>{fieldErrors.password}</FieldError></FormField>
          <Button type="submit" size="lg" disabled={submitting || loading} aria-busy={submitting} className="w-full">{submitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <LogIn className="h-5 w-5" aria-hidden="true" />}{submitting ? "Signing in…" : "Sign in"}</Button>
        </Form></CardContent>
      </Card>
    </main>
  );
}
