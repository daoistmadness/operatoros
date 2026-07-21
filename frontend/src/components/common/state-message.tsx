import * as React from "react";
import { AlertCircle, FilterX, Inbox, Loader2, Lock, Settings } from "lucide-react";
import { cn } from "../../lib/utils";

type StateProps = React.HTMLAttributes<HTMLDivElement> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
};

function StateMessage({ title, description, action, className, children, ...props }: StateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center",
        className
      )}
      {...props}
    >
      {children}
      <p className="mt-3 font-black text-slate-800 text-lg">{title}</p>
      {description && <p className="mt-1.5 max-w-xl text-sm font-semibold text-slate-500">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}

export function EmptyState(props: StateProps) {
  return (
    <StateMessage {...props}>
      <Inbox className="h-8 w-8 text-slate-400" aria-hidden="true" />
    </StateMessage>
  );
}

export function LoadingState(props: StateProps) {
  return (
    <StateMessage role="status" aria-live="polite" {...props}>
      <Loader2 className="h-8 w-8 animate-spin text-brand" aria-hidden="true" />
    </StateMessage>
  );
}

export function ErrorState(props: StateProps) {
  return (
    <StateMessage
      role="alert"
      className={cn("border-rose-200 bg-rose-50/60 text-rose-900", props.className)}
      {...props}
    >
      <AlertCircle className="h-8 w-8 text-rose-500" aria-hidden="true" />
    </StateMessage>
  );
}

export function FilteredEmptyState(props: StateProps) {
  return (
    <StateMessage {...props}>
      <FilterX className="h-8 w-8 text-amber-500" aria-hidden="true" />
    </StateMessage>
  );
}

export function SetupRequiredState(props: StateProps) {
  return (
    <StateMessage
      className={cn("border-amber-200 bg-amber-50/40 text-amber-950", props.className)}
      {...props}
    >
      <Settings className="h-8 w-8 text-amber-600" aria-hidden="true" />
    </StateMessage>
  );
}

export function PermissionRestrictedState(props: StateProps) {
  return (
    <StateMessage
      role="alert"
      className={cn("border-slate-300 bg-slate-100/80 text-slate-800", props.className)}
      {...props}
    >
      <Lock className="h-8 w-8 text-slate-500" aria-hidden="true" />
    </StateMessage>
  );
}
