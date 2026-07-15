import * as React from "react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type StateProps = React.HTMLAttributes<HTMLDivElement> & { title: React.ReactNode; description?: React.ReactNode };

function StateMessage({ title, description, className, children, ...props }: StateProps) {
  return <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-8 text-center", className)} {...props}>{children}<p className="mt-3 font-black text-foreground">{title}</p>{description && <p className="mt-1 max-w-xl text-sm text-muted-foreground">{description}</p>}</div>;
}

export function EmptyState(props: StateProps) { return <StateMessage {...props}><Inbox className="size-6 text-muted-foreground" aria-hidden="true" /></StateMessage>; }
export function LoadingState(props: StateProps) { return <StateMessage role="status" aria-live="polite" {...props}><Loader2 className="size-6 animate-spin text-brand" aria-hidden="true" /></StateMessage>; }
export function ErrorState(props: StateProps) { return <StateMessage role="alert" className={cn("border-danger/40 bg-danger/5", props.className)} {...props}><AlertCircle className="size-6 text-danger" aria-hidden="true" /></StateMessage>; }
