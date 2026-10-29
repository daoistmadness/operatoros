export type ChartLegendItem = {
  label: string;
  color: string;
};

export function ChartLegend({ items, label }: { items: readonly ChartLegendItem[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
