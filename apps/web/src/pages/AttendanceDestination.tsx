import { lazy, Suspense } from "react";
import { BarChart3, ClipboardList, Clock3, FileText } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/cn";
import { RouteLoadingFallback } from "../routes/RouteLoadingFallback";

const AttendanceAnalytics = lazy(() => import("./AttendanceAnalytics"));
const AttendanceReport = lazy(() => import("./AttendanceReport"));
const RekapAbsensi = lazy(() => import("./RekapAbsensi"));
const TardinessReport = lazy(() => import("./TardinessReport"));

const VIEWS = [
  { id: "overview", label: "Overview", icon: BarChart3, page: AttendanceAnalytics },
  { id: "report", label: "Report", icon: FileText, page: AttendanceReport },
  { id: "recap", label: "Recap", icon: ClipboardList, page: RekapAbsensi },
  { id: "tardiness", label: "Tardiness", icon: Clock3, page: TardinessReport },
] as const;

export default function AttendanceDestination() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const selected = VIEWS.find((view) => view.id === searchParams.get("view")) ?? VIEWS[0];
  const ActiveView = selected.page;

  return <div className="space-y-5">
    <nav aria-label="Attendance views" className="flex flex-wrap gap-2 border-b border-slate-200" role="tablist">
      {VIEWS.map(({ id, label, icon: Icon }) => {
        const params = new URLSearchParams(searchParams);
        params.set("view", id);
        return <Link
          key={id}
          to={{ pathname: "/analytics/attendance", search: `?${params.toString()}` }}
          role="tab"
          aria-selected={selected.id === id}
          aria-controls="attendance-view-panel"
          className={cn("inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold", selected.id === id ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800")}
        ><Icon aria-hidden="true" size={16} />{label}</Link>;
      })}
      {user?.role === "admin" && <Link to="/attendance/monthly-recap" className="ml-auto inline-flex min-h-11 items-center px-3 text-sm font-semibold text-slate-600 underline underline-offset-4">Monthly Recap Input</Link>}
    </nav>
    <section id="attendance-view-panel" role="tabpanel" aria-label={`${selected.label} attendance view`}>
      <Suspense fallback={<RouteLoadingFallback />}><ActiveView /></Suspense>
    </section>
  </div>;
}
