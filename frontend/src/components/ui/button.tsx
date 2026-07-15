import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva("inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50", { variants: { variant: { primary: "bg-primary text-primary-foreground hover:bg-primary-hover", secondary: "bg-surface-muted text-foreground hover:bg-slate-200", success: "bg-success text-white hover:bg-emerald-700", warning: "bg-warning text-white hover:bg-amber-700", danger: "bg-danger text-white hover:bg-rose-700", outline: "border border-border bg-surface text-foreground hover:bg-surface-muted", ghost: "text-foreground hover:bg-surface-muted" }, size: { default: "h-10", sm: "h-9 px-3", lg: "h-12 px-6", icon: "size-10 p-0" } }, defaultVariants: { variant: "primary", size: "default" } });

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = "button", ...props }, ref) => <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />);
Button.displayName = "Button";
