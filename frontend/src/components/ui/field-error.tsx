import * as React from "react";
import { useFieldContext } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type FieldErrorProps = React.HTMLAttributes<HTMLDivElement> & {
  errors?: React.ReactNode | React.ReactNode[];
};

export const FieldError = React.forwardRef<HTMLDivElement, FieldErrorProps>(
  ({ id, className, children, errors, ...props }, ref) => {
    const field = useFieldContext();
    const messages = React.Children.toArray(errors ?? children).filter(Boolean);
    if (messages.length === 0) return null;

    return (
      <div
        ref={ref}
        id={id || field?.errorId}
        role="alert"
        aria-live="polite"
        className={cn("text-sm font-semibold text-danger", className)}
        {...props}
      >
        {messages.length === 1 ? messages[0] : (
          <ul className="list-disc space-y-1 pl-5">
            {messages.map((message, index) => <li key={index}>{message}</li>)}
          </ul>
        )}
      </div>
    );
  },
);

FieldError.displayName = "FieldError";
