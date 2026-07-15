import * as React from "react";
import { cn } from "@/lib/utils";

type FormSectionProps = React.HTMLAttributes<HTMLElement> & {
  title: React.ReactNode;
  description?: React.ReactNode;
};

export function FormSection({ title, description, className, children, ...props }: FormSectionProps) {
  const titleId = React.useId();
  return (
    <section aria-labelledby={titleId} className={cn("space-y-4", className)} {...props}>
      <div className="space-y-1">
        <h2 id={titleId} className="text-base font-black text-foreground">{title}</h2>
        {description && <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
