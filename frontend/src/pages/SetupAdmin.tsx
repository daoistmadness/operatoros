import React, { useRef, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { bootstrapSetupAuthorization } from "../api/setup";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "../components/ui/card";
import { FieldDescription, FieldLabel, FormField } from "../components/ui/field";
import { FieldError } from "../components/ui/field-error";
import { Form } from "../components/ui/form";
import { Input } from "../components/ui/input";
import { useProvisionFirstAdminMutation } from "../hooks/useSetupQueries";
import { queryKeys } from "../lib/query/queryKeys";

function errorCode(error: unknown): string | undefined {
  return (error as { data?: { detail?: { code?: string } } })?.data?.detail?.code;
}

function PasswordInput({ id, name, value, onChange, visible, onToggle }: { id: string; name: string; value: string; onChange: (value: string) => void; visible: boolean; onToggle: () => void }) {
  return <div className="relative"><Input id={id} type={visible ? "text" : "password"} autoComplete="new-password" value={value} onChange={(event) => onChange(event.target.value)} className="pr-11" /><button type="button" aria-label={visible ? `Hide ${name}` : `Show ${name}`} aria-pressed={visible} onClick={onToggle} className="absolute right-1 top-1 inline-flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800">{visible ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}</button></div>;
}

export default function SetupAdmin() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const mutation = useProvisionFirstAdminMutation();
  const usernameRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [validationError, setValidationError] = useState("");
  const passwordLongEnough = password.length >= 12;
  const passwordsMatch = confirmation.length > 0 && password === confirmation;
  const formReady = Boolean(username.trim()) && passwordLongEnough && passwordsMatch;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mutation.isPending) return;
    setValidationError("");
    if (!username.trim()) { setValidationError("Enter an administrator username."); usernameRef.current?.focus(); return; }
    if (!passwordLongEnough) { setValidationError("Password must be at least 12 characters long."); return; }
    if (!passwordsMatch) { setValidationError("Password confirmation does not match."); return; }
    try {
      await bootstrapSetupAuthorization();
      await mutation.mutateAsync({ username: username.trim(), password, password_confirmation: confirmation });
      setPassword(""); setConfirmation("");
      window.sessionStorage.setItem("astryx:login-notice", "Administrator created. Sign in with your new account.");
      navigate("/login", { replace: true });
    } catch (error) {
      const code = errorCode(error);
      if (code === "SETUP_ALREADY_COMPLETED") { await client.invalidateQueries({ queryKey: queryKeys.setup.all }); navigate("/login", { replace: true }); return; }
      setValidationError(code === "PASSWORD_POLICY_FAILED" ? "Password must be at least 12 characters long." : "Administrator could not be created. Check your details and try again.");
    }
  };

  return <main className="flex min-h-screen items-start justify-center overflow-y-auto bg-slate-950 px-4 py-8 sm:items-center sm:py-12">
    <Card className="my-auto w-full max-w-lg rounded-3xl border-white/10 shadow-2xl" aria-labelledby="setup-title">
      <CardHeader className="gap-4 pb-5"><div className="flex items-center gap-4"><div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-white"><ShieldCheck className="size-7" aria-hidden="true" /></div><div><p className="text-xs font-black uppercase tracking-[0.18em] text-brand">OperatorOS first run</p><h1 id="setup-title" className="text-2xl font-black tracking-tight">Create administrator</h1></div></div><CardDescription className="leading-relaxed">Create the first local administrator for this installation. After setup, this screen will no longer be available.</CardDescription></CardHeader>
      <CardContent>
        {validationError && <Alert variant="danger" className="mb-5 font-semibold" aria-live="assertive">{validationError}</Alert>}
        <Form onSubmit={submit}>
          <FormField id="administrator-username" required><FieldLabel>Administrator username</FieldLabel><Input ref={usernameRef} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} autoFocus /></FormField>
          <FormField id="password" required invalid={password.length > 0 && !passwordLongEnough}><FieldLabel>Password</FieldLabel><PasswordInput id="password" name="administrator password" value={password} onChange={setPassword} visible={showPassword} onToggle={() => setShowPassword((shown) => !shown)} /><FieldDescription>Use at least 12 characters.</FieldDescription><FieldError>{password.length > 0 && !passwordLongEnough ? "Password is too short." : null}</FieldError></FormField>
          <FormField id="confirm-password" required invalid={confirmation.length > 0 && !passwordsMatch}><FieldLabel>Confirm password</FieldLabel><PasswordInput id="confirm-password" name="password confirmation" value={confirmation} onChange={setConfirmation} visible={showConfirmation} onToggle={() => setShowConfirmation((shown) => !shown)} /><div className="min-h-5" aria-live="polite">{passwordsMatch && <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700"><CheckCircle2 className="size-4" aria-hidden="true" />Passwords match.</p>}<FieldError>{confirmation.length > 0 && !passwordsMatch ? "Passwords do not match." : null}</FieldError></div></FormField>
          <Button type="submit" size="lg" disabled={!formReady || mutation.isPending} aria-busy={mutation.isPending} className="w-full">{mutation.isPending && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}{mutation.isPending ? "Creating administrator…" : "Create administrator"}</Button>
        </Form>
      </CardContent>
    </Card>
  </main>;
}
