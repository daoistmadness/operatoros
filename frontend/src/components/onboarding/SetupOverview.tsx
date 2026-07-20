import React from "react";
import { CheckCircle2, Circle, Lock, RefreshCw, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReadinessResponse, ReadinessStep } from "../../api/readiness";
import { Badge } from "../ui/badge";
import { Button, buttonVariants } from "../ui/button";
import { Card } from "../ui/card";
import { cn } from "../../lib/cn";

const overallCopy: Record<ReadinessResponse["overall_status"], { title: string; description: string }> = {
  FIRST_RUN: { title: "Initial setup is required", description: "Complete the required foundations below. You can leave this page and resume setup at any time." },
  SETUP_PARTIAL: { title: "Setup is in progress", description: "Some required foundations are complete. Continue with the next available step." },
  READY_WITH_RECOMMENDATIONS: { title: "Core setup is ready", description: "Daily workflows are available. The remaining recommendations enable additional grade, attendance, or analytics features." },
  OPERATIONALLY_READY: { title: "OperatorOS is ready", description: "Required foundations and workflow data are available." },
  READ_ONLY_GUIDANCE: { title: "Setup needs administrator attention", description: "You can continue using permitted read-only workflows while an administrator completes the required steps." },
};

const requirementVariant = (requirement: ReadinessStep["requirement"]) =>
  requirement === "REQUIRED" ? "warning" : requirement === "OPTIONAL" ? "secondary" : "information";

export function SetupOverview({ data, isLoading, isError, onRetry }: { data?: ReadinessResponse; isLoading: boolean; isError: boolean; onRetry: () => void }) {
  if (isLoading) return <Card role="status" aria-live="polite" className="p-5"><p className="font-black text-slate-800">Checking setup readiness…</p><p className="mt-1 text-sm text-slate-500">Comparing academic, student, enrollment, and workflow prerequisites.</p></Card>;
  if (isError || !data) return <Card role="alert" className="border-rose-200 bg-rose-50 p-5"><h2 className="font-black text-rose-900">Setup readiness is unavailable</h2><p className="mt-1 text-sm font-semibold text-rose-700">This request failed; setup has not been classified as incomplete.</p><Button variant="outline" className="mt-4" onClick={onRetry}><RefreshCw aria-hidden="true" className="size-4" />Retry readiness check</Button></Card>;

  const copy = overallCopy[data.overall_status];
  return <Card className="overflow-hidden border-slate-200" aria-labelledby="setup-overview-title">
    <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50 p-5 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="text-xs font-black uppercase tracking-[0.16em] text-brand">Getting started</p><h2 id="setup-overview-title" className="mt-1 text-xl font-black text-slate-900">{copy.title}</h2><p className="mt-1 max-w-3xl text-sm font-semibold text-slate-600">{copy.description}</p></div>
      <Badge variant={data.overall_status === "OPERATIONALLY_READY" ? "success" : data.overall_status === "READ_ONLY_GUIDANCE" ? "secondary" : "warning"} className="shrink-0 self-start">{data.overall_status.replaceAll("_", " ")}</Badge>
    </div>
    <ol className="divide-y divide-slate-100">
      {data.steps.map((step) => <li key={step.code} className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 items-start gap-3">
          {step.status === "COMPLETE" ? <CheckCircle2 aria-label="Complete" className="mt-0.5 size-5 shrink-0 text-emerald-600" /> : step.can_manage ? <Circle aria-label={step.status === "OPTIONAL" ? "Optional" : "Not started"} className="mt-0.5 size-5 shrink-0 text-amber-600" /> : <Lock aria-label="Restricted" className="mt-0.5 size-5 shrink-0 text-slate-500" />}
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-slate-900">{step.name}</h3><Badge variant={requirementVariant(step.requirement)}>{step.requirement}</Badge>{step.status === "COMPLETE" && <Badge variant="success">Complete</Badge>}</div><p className="mt-1 text-sm font-semibold text-slate-600">{step.reason}</p>{step.responsibility && <p className="mt-1 text-sm font-bold text-slate-500">{step.responsibility}</p>}</div>
        </div>
        {step.destination && <Link to={step.destination} className={cn(buttonVariants({ variant: step.requirement === "REQUIRED" && step.status !== "COMPLETE" ? "primary" : "outline", size: "sm" }), "w-full sm:w-auto")}><Settings2 aria-hidden="true" className="size-4" />{step.status === "COMPLETE" ? "Review" : step.can_manage ? "Continue setup" : "View guidance"}</Link>}
      </li>)}
    </ol>
  </Card>;
}
