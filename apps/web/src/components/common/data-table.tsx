import * as React from "react";
import { cn } from "@/lib/utils";

export function DataTableContainer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("overflow-x-auto rounded-xl border border-border", className)} {...props} />;
}
export const DataTable = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(({ className, ...props }, ref) => <table ref={ref} className={cn("min-w-full border-collapse text-sm", className)} {...props} />);
DataTable.displayName = "DataTable";
export const DataTableHeader = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className={cn("bg-surface-muted text-left text-xs font-black uppercase tracking-wide text-muted-foreground", className)} {...props} />;
export const DataTableBody = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className={cn("divide-y divide-border bg-surface", className)} {...props} />;
export const DataTableRow = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn("transition-colors hover:bg-surface-muted/60", className)} {...props} />;
export const DataTableHead = ({ className, scope = "col", ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th scope={scope} className={cn("px-4 py-3", className)} {...props} />;
export const DataTableCell = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("px-4 py-3 align-top", className)} {...props} />;
