import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type DataTableColumnOption = {
  id: string;
  label: string;
  visible: boolean;
  disabled?: boolean;
};

export function DataTableToolbar({
  searchId,
  searchLabel,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  children,
}: {
  searchId: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3" role="search">
      <div className="relative min-w-56 flex-1">
        <Search aria-hidden="true" className="absolute left-3 top-3 size-4 text-muted-foreground" />
        <Label className="sr-only" htmlFor={searchId}>{searchLabel}</Label>
        <Input
          id={searchId}
          className="pl-9"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      {children}
    </div>
  );
}

export function DataTableColumnVisibility({
  columns,
  onChange,
}: {
  columns: readonly DataTableColumnOption[];
  onChange: (id: string, visible: boolean) => void;
}) {
  if (columns.length === 0) return null;

  return (
    <details className="relative shrink-0">
      <summary className="cursor-pointer list-none rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Columns
      </summary>
      <fieldset className="absolute right-0 z-20 mt-2 grid min-w-48 gap-2 rounded-lg border border-border bg-surface p-3 text-sm shadow-lg">
        <legend className="sr-only">Visible table columns</legend>
        {columns.map((column) => (
          <label key={column.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={column.visible}
              disabled={column.disabled}
              onChange={(event) => onChange(column.id, event.target.checked)}
            />
            <span>{column.label}</span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}
