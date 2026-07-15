import * as React from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = React.HTMLAttributes<HTMLElement> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
};

export function PageHeader({ title, description, actions, eyebrow, className, ...props }: PageHeaderProps) {
  const titleId = React.useId();
  return (
    <header aria-labelledby={titleId} className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)} {...props}>
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">{eyebrow}</p>}
        <h1 id={titleId} className="mt-1 text-2xl font-black tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2" aria-label="Page actions">{actions}</div>}
    </header>
  );
}
