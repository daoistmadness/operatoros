import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) { return <CheckboxPrimitive.Root className={cn("peer size-4 shrink-0 rounded border border-border bg-surface focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-primary data-[state=checked]:text-white", className)} {...props}><CheckboxPrimitive.Indicator><Check className="size-4"/></CheckboxPrimitive.Indicator></CheckboxPrimitive.Root>; }
