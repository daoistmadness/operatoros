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
        "flex min-w-0 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-muted p-6 text-center text-foreground sm:p-8",
        className
      )}
      {...props}
    >
      {children}
      <p className="mt-3 text-lg font-bold text-foreground">{title}</p>
      {description && <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}

export function EmptyState(props: StateProps) {
  return (
    <StateMessage {...props}>
      <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
    </StateMessage>
  );
}

export function LoadingState(props: StateProps) {
  return (
    <StateMessage role="status" aria-live="polite" {...props}>
      <Loader2 className="h-8 w-8 text-brand motion-safe:animate-spin" aria-hidden="true" />
    </StateMessage>
  );
}

export function ErrorState(props: StateProps) {
  return (
    <StateMessage
      role="alert"
      className={cn("border-danger/20 bg-danger-surface text-danger", props.className)}
      {...props}
    >
      <AlertCircle className="h-8 w-8 text-danger" aria-hidden="true" />
    </StateMessage>
  );
}

export function FilteredEmptyState(props: StateProps) {
  return (
    <StateMessage {...props}>
      <FilterX className="h-8 w-8 text-warning" aria-hidden="true" />
    </StateMessage>
  );
}

export function SetupRequiredState(props: StateProps) {
  return (
    <StateMessage
      className={cn("border-warning/30 bg-warning-surface text-warning-foreground", props.className)}
      {...props}
    >
      <Settings className="h-8 w-8 text-warning" aria-hidden="true" />
    </StateMessage>
  );
}

export function PermissionRestrictedState(props: StateProps) {
  return (
    <StateMessage
      role="alert"
      className={cn("border-border bg-surface-muted text-foreground", props.className)}
      {...props}
    >
      <Lock className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
    </StateMessage>
  );
}
