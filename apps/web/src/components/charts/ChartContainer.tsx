import type { ReactNode } from "react";

type ChartContainerProps =
  | { state: "ready"; ariaLabel: string; children: ReactNode; className?: string }
  | { state: "loading"; message?: string; className?: string }
  | { state: "empty"; message?: string; className?: string }
  | { state: "error"; message: string; className?: string };

const defaultMessage = "No chart data is available.";

export function ChartContainer(props: ChartContainerProps) {
  const className = `relative h-56 w-full min-w-0 ${props.className ?? ""}`.trim();

  if (props.state === "ready") {
    return (
      <div className={className}>
        <div role="img" aria-label={props.ariaLabel} className="h-full w-full">
          {props.children}
        </div>
      </div>
    );
  }

  if (props.state === "loading") {
    return (
      <div role="status" aria-busy="true" className={`${className} flex items-center justify-center text-sm text-muted-foreground`}>
        {props.message ?? "Loading chart…"}
      </div>
    );
  }

  if (props.state === "error") {
    return (
      <div role="alert" className={`${className} flex items-center justify-center text-sm text-danger`}>
        {props.message}
      </div>
    );
  }

  return (
    <div role="status" className={`${className} flex items-center justify-center text-sm text-muted-foreground`}>
      {props.message ?? defaultMessage}
    </div>
  );
}
