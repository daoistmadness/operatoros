import * as React from "react";
import { cn } from "@/lib/utils";
import { useFieldContext } from "@/components/ui/field";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, id, disabled, required, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy, ...props }, ref) => {
  const field = useFieldContext();
  const invalid = ariaInvalid ?? field?.invalid;
  const describedBy = ariaDescribedBy || (field ? [field.descriptionId, field.invalid ? field.errorId : null].filter(Boolean).join(" ") : undefined);
  return <input ref={ref} id={id || field?.controlId} disabled={disabled ?? field?.disabled} required={required ?? field?.required} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={cn("flex h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-danger/20", className)} {...props} />;
});
Input.displayName = "Input";
