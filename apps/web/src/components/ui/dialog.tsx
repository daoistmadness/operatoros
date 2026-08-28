import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const restoreTarget = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (props.open && !wasOpen.current) restoreTarget.current = document.activeElement as HTMLElement | null;
    if (!props.open && wasOpen.current) queueMicrotask(() => restoreTarget.current?.focus());
    wasOpen.current = Boolean(props.open);
  }, [props.open]);
  return <DialogPrimitive.Root {...props} />;
}
export const DialogTrigger = DialogPrimitive.Trigger; export const DialogClose = DialogPrimitive.Close;
type DialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean };
export function DialogContent({ className, children, showClose = true, ...props }: DialogContentProps) { return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm data-[state=open]:animate-in"/><DialogPrimitive.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-elevated)]", className)} {...props}>{children}{showClose ? <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Close dialog"><X className="size-5"/></DialogPrimitive.Close> : null}</DialogPrimitive.Content></DialogPrimitive.Portal>; }
export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("flex flex-col gap-2", className)} {...props}/>;
export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end", className)} {...props}/>;
export const DialogTitle = ({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) => <DialogPrimitive.Title className={cn("text-xl font-black", className)} {...props}/>;
export const DialogDescription = ({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) => <DialogPrimitive.Description className={cn("text-sm leading-relaxed text-muted-foreground", className)} {...props}/>;
