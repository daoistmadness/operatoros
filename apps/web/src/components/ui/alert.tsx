import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const alertVariants = cva("relative w-full rounded-lg border p-4 text-sm", { variants: { variant: { default: "border-border bg-surface text-foreground", success: "border-emerald-200 bg-emerald-50 text-emerald-900", warning: "border-amber-200 bg-amber-50 text-amber-950", danger: "border-rose-200 bg-rose-50 text-rose-900", information: "border-blue-200 bg-blue-50 text-blue-900" } }, defaultVariants: { variant: "default" } });
export function Alert({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) { return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />; }
export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) { return <h5 className={cn("mb-1 font-bold", className)} {...props} />; }
export function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("text-sm leading-relaxed", className)} {...props} />; }
