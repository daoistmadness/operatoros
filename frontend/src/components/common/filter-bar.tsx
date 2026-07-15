import * as React from "react";
import { cn } from "@/lib/utils";

export function FilterBar({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section aria-label="Filters" className={cn("rounded-2xl border border-border bg-surface p-4 shadow-sm", className)} {...props} />;
}

export function ActionGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="group" aria-label="Actions" className={cn("flex flex-wrap items-center gap-2", className)} {...props} />;
}
