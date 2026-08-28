import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldContextValue = {
  controlId: string;
  descriptionId: string;
  errorId: string;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
};

const FieldContext = React.createContext<FieldContextValue | null>(null);

export function useFieldContext() {
  return React.useContext(FieldContext);
}

type FormFieldProps = React.HTMLAttributes<HTMLDivElement> & {
  id?: string;
  invalid?: boolean;
  required?: boolean;
  disabled?: boolean;
};

export const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(
  ({ id, invalid = false, required = false, disabled = false, className, children, ...props }, ref) => {
    const generatedId = React.useId();
    const controlId = id || `field-${generatedId.replace(/:/g, "")}`;
    const context = React.useMemo(
      () => ({
        controlId,
        descriptionId: `${controlId}-description`,
        errorId: `${controlId}-error`,
        invalid,
        required,
        disabled,
      }),
      [controlId, disabled, invalid, required],
    );

    return (
      <FieldContext.Provider value={context}>
        <div
          ref={ref}
          className={cn("space-y-2", className)}
          data-disabled={disabled || undefined}
          data-invalid={invalid || undefined}
          {...props}
        >
          {children}
        </div>
      </FieldContext.Provider>
    );
  },
);

FormField.displayName = "FormField";

type FieldLabelProps = React.ComponentProps<typeof Label> & {
  requiredIndicator?: React.ReactNode;
};

export function FieldLabel({ className, children, htmlFor, requiredIndicator = "*", ...props }: FieldLabelProps) {
  const field = useFieldContext();
  const required = field?.required;
  return (
    <Label
      htmlFor={htmlFor || field?.controlId}
      className={cn("inline-flex items-center gap-1", field?.disabled && "cursor-not-allowed opacity-60", className)}
      {...props}
    >
      {children}
      {required && (
        <span className="text-danger" aria-hidden="true">
          {requiredIndicator}
        </span>
      )}
      {required && <span className="sr-only"> required</span>}
    </Label>
  );
}

export const FieldDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ id, className, ...props }, ref) => {
    const field = useFieldContext();
    return (
      <p
        ref={ref}
        id={id || field?.descriptionId}
        className={cn("text-sm leading-relaxed text-muted-foreground", className)}
        {...props}
      />
    );
  },
);

FieldDescription.displayName = "FieldDescription";
