import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold", { variants: { variant: { default: "bg-primary/10 text-primary", secondary: "bg-surface-muted text-slate-700", success: "bg-emerald-100 text-emerald-800", warning: "bg-amber-100 text-amber-900", danger: "bg-rose-100 text-rose-800", information: "bg-blue-100 text-blue-800" } }, defaultVariants: { variant: "default" } });
export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) { return <span className={cn(badgeVariants({ variant }), className)} {...props} />; }
