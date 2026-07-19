import React, { type ReactNode } from "react";
import { useSetupStatusQuery } from "../../hooks/useSetupQueries";
import SetupAdmin from "../../pages/SetupAdmin";
import { Button } from "@/components/ui/button";

export function SetupBoundary({ children }: { children: ReactNode }) {
  const status = useSetupStatusQuery();
  if (status.isLoading) {
    return <main aria-live="polite" className="flex min-h-screen items-center justify-center bg-slate-950 text-sm font-bold text-white">Checking OperatorOS setup…</main>;
  }
  if (status.isError || !status.data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <section role="alert" className="max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
          <h1 className="text-xl font-black text-slate-900">Setup status unavailable</h1>
          <p className="mt-3 text-sm text-slate-600">Confirm the FastAPI backend is running, then retry.</p>
          <Button onClick={() => status.refetch()} className="mt-6">Retry</Button>
        </section>
      </main>
    );
  }
  return status.data.setup_required
    ? <SetupAdmin />
    : <>{children}</>;
}
