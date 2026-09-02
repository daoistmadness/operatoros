import { CheckCircle2, CircleAlert, CircleDashed, LockKeyhole, OctagonAlert, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { FeatureReadiness, ReadinessItem, ReadinessState } from "@operatoros/contracts/readiness";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { buttonVariants } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";

const stateLabel: Record<ReadinessState, string> = {
  READY: "Ready",
  ACTION_REQUIRED: "Action required",
  BLOCKED: "Blocked",
  ERROR: "Unavailable",
  NOT_APPLICABLE: "Not applicable",
};

const stateVariant: Record<ReadinessState, "success" | "warning" | "secondary" | "danger" | "information"> = {
  READY: "success",
  ACTION_REQUIRED: "warning",
  BLOCKED: "secondary",
  ERROR: "danger",
  NOT_APPLICABLE: "information",
};

const readinessLabel: Record<string, string> = {
  academic_year: "Academic year",
  jenjang: "Programs / Jenjang",
  academic_periods: "Academic periods",
  classes: "Classes",
  calendar: "School calendar",
  students: "Students",
  enrollment: "Enrollment",
};

function StateIcon({ state }: { state: ReadinessState }) {
  if (state === "READY") return <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-emerald-600" />;
  if (state === "ERROR") return <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-rose-600" />;
  if (state === "BLOCKED") return <LockKeyhole aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-slate-500" />;
  if (state === "NOT_APPLICABLE") return <OctagonAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-slate-500" />;
  return <CircleDashed aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-600" />;
}

function ActionLinks({ actions }: { actions: ReadinessItem["actions"] | FeatureReadiness["actions"] }) {
  return actions.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">
    {actions.map((action) => <Link key={action.code} to={action.route} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
      <Settings2 aria-hidden="true" className="size-4" />{action.label}
    </Link>)}
  </div> : null;
}

export function ReadinessChecklist({ items }: { items: ReadinessItem[] }) {
  return <Card aria-labelledby="foundation-readiness-title">
    <CardHeader>
      <CardTitle id="foundation-readiness-title">Foundation</CardTitle>
      <p className="text-sm text-muted-foreground">Canonical setup that enables OperatorOS workflows.</p>
    </CardHeader>
    <CardContent className="pt-0">
      <ul className="divide-y divide-border">
        {items.map((item) => <li key={item.key} className="py-4 first:pt-0 last:pb-0">
          <div className="flex items-start gap-3">
            <StateIcon state={item.state} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-black text-foreground">{item.label}</h3>
                <Badge variant={stateVariant[item.state]}>{stateLabel[item.state]}</Badge>
                {item.count !== undefined && <span className="text-xs font-bold text-muted-foreground">{item.count}</span>}
              </div>
              <p className="mt-1 text-sm font-semibold text-muted-foreground">{item.summary}</p>
              {item.blockers?.length ? <p className="mt-1 text-xs font-bold text-muted-foreground">Blocked by: {item.blockers.map((key) => readinessLabel[key] ?? key).join(", ")}</p> : null}
              <ActionLinks actions={item.actions} />
            </div>
          </div>
        </li>)}
      </ul>
    </CardContent>
  </Card>;
}

export function FeatureReadinessCard({ feature }: { feature: FeatureReadiness }) {
  return <Card aria-labelledby={`feature-readiness-${feature.key}`}>
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle id={`feature-readiness-${feature.key}`}>{feature.label}</CardTitle>
        <Badge variant={stateVariant[feature.state]}>{stateLabel[feature.state]}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{feature.state === "READY" ? "The required foundation is available." : "This workflow is waiting for the listed foundation items."}</p>
    </CardHeader>
    <CardContent className="pt-0">
      {feature.blockers.length > 0 && <p className="text-sm font-semibold text-muted-foreground">Blockers: {feature.blockers.map((key) => readinessLabel[key] ?? key).join(", ")}</p>}
      <ActionLinks actions={feature.actions} />
      {feature.state === "READY" && <Link to={feature.route} className={cn(buttonVariants({ variant: "primary", size: "sm" }), "mt-3")}>
        Open {feature.label}
      </Link>}
    </CardContent>
  </Card>;
}
