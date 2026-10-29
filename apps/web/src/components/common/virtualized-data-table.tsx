import { useLayoutEffect, useMemo, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const ROW_HEIGHT = 56;
const VIRTUALIZATION_THRESHOLD = 100;
const OVERSCAN = 8;
const FOCUSABLE_SELECTOR = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

type FocusTarget = { index: number; edge: "first" | "last" };

export function VirtualizedDataTable<TRow>({
  caption,
  rows,
  getRowId,
  columnCount,
  header,
  renderCells,
  emptyMessage,
}: {
  caption: string;
  rows: readonly TRow[];
  getRowId: (row: TRow) => string;
  columnCount: number;
  header: ReactNode;
  renderCells: (row: TRow) => ReactNode;
  emptyMessage: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => {
      const row = rows.at(index);
      return row ? getRowId(row) : `missing-row-${index}`;
    },
    overscan: OVERSCAN,
    useFlushSync: false,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const isVirtualized = rows.length >= VIRTUALIZATION_THRESHOLD;
  const firstVirtualIndex = virtualRows.at(0)?.index ?? 0;
  const lastVirtualIndex = virtualRows.at(-1)?.index ?? -1;
  const virtualRowIndices = useMemo(() => new Set(virtualRows.map((item) => item.index)), [virtualRows]);

  useLayoutEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [rows]);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target || !virtualRowIndices.has(target.index)) return;

    const row = viewportRef.current?.querySelector<HTMLTableRowElement>(`tr[data-index="${target.index}"]`);
    const focusable = row?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const element = target.edge === "first" ? focusable?.item(0) : focusable?.item((focusable.length || 1) - 1);
    pendingFocus.current = null;
    element?.focus();
  }, [virtualRowIndices]);

  const focusNeighborRow = (index: number, edge: FocusTarget["edge"]) => {
    if (index < 0 || index >= rows.length) return;
    const row = viewportRef.current?.querySelector<HTMLTableRowElement>(`tr[data-index="${index}"]`);
    const focusable = row?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const element = edge === "first" ? focusable?.item(0) : focusable?.item((focusable?.length || 1) - 1);
    if (element) {
      pendingFocus.current = null;
      element.focus();
      return;
    }
    pendingFocus.current = { index, edge };
    rowVirtualizer.scrollToIndex(index, { align: edge === "first" ? "start" : "end" });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isVirtualized || event.key !== "Tab") return;
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return;
    const activeRow = activeElement.closest<HTMLTableRowElement>("tr[data-index]");
    const index = Number(activeRow?.dataset.index);
    if (!activeRow || !Number.isInteger(index)) return;
    const focusable = Array.from(activeRow.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) return;

    if (event.shiftKey && index === firstVirtualIndex && activeElement === focusable[0] && index > 0) {
      event.preventDefault();
      focusNeighborRow(index - 1, "last");
    } else if (!event.shiftKey && index === lastVirtualIndex && activeElement === focusable.at(-1) && index < rows.length - 1) {
      event.preventDefault();
      focusNeighborRow(index + 1, "first");
    }
  };

  const renderRow = (row: TRow, index: number) => (
    <tr
      key={getRowId(row)}
      data-row-id={getRowId(row)}
      data-index={isVirtualized ? index : undefined}
      aria-rowindex={index + 2}
      className="h-14 border-b border-slate-100 transition-colors hover:bg-slate-50/80"
    >
      {renderCells(row)}
    </tr>
  );

  const topPadding = isVirtualized ? virtualRows.at(0)?.start ?? 0 : 0;
  const bottomPadding = isVirtualized && virtualRows.length > 0
    ? rowVirtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? rowVirtualizer.getTotalSize())
    : 0;

  return (
    <div
      ref={viewportRef}
      className={isVirtualized ? "max-h-[36rem] overflow-auto" : "overflow-x-auto"}
      data-table-viewport
      onKeyDownCapture={handleKeyDown}
      tabIndex={isVirtualized ? 0 : undefined}
      aria-label={isVirtualized ? `${caption} results; use Tab to move through row actions` : undefined}
    >
      <table className="w-full text-left text-xs" aria-rowcount={rows.length === 0 ? 2 : rows.length + 1}>
        <caption className="sr-only">{caption}</caption>
        {header}
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr aria-rowindex={2}><td colSpan={Math.max(columnCount, 1)} className="p-8 text-center text-slate-400 italic">{emptyMessage}</td></tr>
          ) : isVirtualized ? (
            <>
              {topPadding > 0 && <tr aria-hidden="true"><td colSpan={columnCount} style={{ height: topPadding, padding: 0, border: 0 }} /></tr>}
              {virtualRows.map((item) => {
                const row = rows.at(item.index);
                return row ? renderRow(row, item.index) : null;
              })}
              {bottomPadding > 0 && <tr aria-hidden="true"><td colSpan={columnCount} style={{ height: bottomPadding, padding: 0, border: 0 }} /></tr>}
            </>
          ) : rows.map(renderRow)}
        </tbody>
      </table>
    </div>
  );
}
