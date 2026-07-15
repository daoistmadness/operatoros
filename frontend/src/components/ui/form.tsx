import * as React from "react";
import { cn } from "@/lib/utils";

export const Form = React.forwardRef<
  HTMLFormElement,
  React.FormHTMLAttributes<HTMLFormElement>
>(({ className, noValidate = true, ...props }, ref) => (
  <form ref={ref} noValidate={noValidate} className={cn("space-y-5", className)} {...props} />
));

Form.displayName = "Form";
