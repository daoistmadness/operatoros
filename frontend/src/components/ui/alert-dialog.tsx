import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";

export const AlertDialog = Dialog;
export const AlertDialogTrigger = DialogPrimitive.Trigger;
export const AlertDialogCancel = DialogPrimitive.Close;
export const AlertDialogAction = DialogPrimitive.Close;
export const AlertDialogHeader = DialogHeader;
export const AlertDialogFooter = DialogFooter;
export const AlertDialogTitle = DialogTitle;
export const AlertDialogDescription = DialogDescription;

export function AlertDialogContent({ className, ...props }: React.ComponentProps<typeof DialogContent>) {
  return <DialogContent role="alertdialog" showClose={false} className={cn("max-w-md", className)} {...props} />;
}
