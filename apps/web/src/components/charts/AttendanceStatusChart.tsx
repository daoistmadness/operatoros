import { VisAxis, VisGroupedBar, VisGroupedBarSelectors, VisXYContainer } from "@unovis/react";
import { ChartContainer } from "./ChartContainer";
import { ChartLegend } from "./ChartLegend";
import { ChartTooltip } from "./ChartTooltip";
import {
  getAttendanceStatusChartLabel,
  getAttendanceStatusTooltipText,
  type AttendanceStatusChartDatum,
} from "../../lib/charts/attendanceStatusChart";

export function AttendanceStatusChart({ data }: { data: readonly AttendanceStatusChartDatum[] }) {
  const maxValue = Math.max(1, ...data.map((row) => row.value));
  const ariaLabel = getAttendanceStatusChartLabel(data);

  return (
    <div className="min-w-0 space-y-3">
      <ChartContainer state="ready" ariaLabel={ariaLabel}>
        <VisXYContainer<AttendanceStatusChartDatum>
          className="h-full w-full min-w-0"
          style={{ width: "100%", maxWidth: "100%" }}
          data={[...data]}
          height="100%"
          duration={0}
          yDomain={[0, maxValue]}
        >
          <VisGroupedBar<AttendanceStatusChartDatum>
            x={(row) => row.index}
            y={(row) => row.value}
            color={(row) => row.color}
            barMinHeight={0}
            roundedCorners={2}
          />
          <VisAxis<AttendanceStatusChartDatum>
            type="x"
            tickValues={data.map((row) => row.index)}
            tickFormat={(tick) => data[Math.round(Number(tick))]?.label ?? ""}
            tickTextFontSize="12px"
            gridLine={false}
            tickLine={false}
            domainLine={false}
          />
          <VisAxis<AttendanceStatusChartDatum>
            type="y"
            tickFormat={(tick) => Number(tick).toLocaleString()}
            tickTextFontSize="12px"
            tickLine={false}
            domainLine={false}
          />
          <ChartTooltip selector={VisGroupedBarSelectors.bar} getText={getAttendanceStatusTooltipText} />
        </VisXYContainer>
      </ChartContainer>
      <ChartLegend items={data} label="Attendance status colors" />
    </div>
  );
}
