import { VisTooltip } from "@unovis/react";

type ChartTooltipProps = {
  selector: string;
  getText: (datum: unknown) => string | null;
};

export function ChartTooltip({ selector, getText }: ChartTooltipProps) {
  return (
    <VisTooltip
      showDelay={0}
      triggers={{
        [selector]: (datum: unknown) => {
          const text = getText(datum);
          if (text === null) return null;

          const content = document.createElement("span");
          content.textContent = text;
          return content;
        },
      }}
    />
  );
}
