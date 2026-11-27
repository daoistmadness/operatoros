import { lazy, Suspense } from "react";
import { BarChart3, ClipboardList, Clock3, FileText } from "lucide-react";
import { AppLink as Link } from '../components/AppLink';
import { useUrlSearchParams as useSearchParams } from '../lib/router/search';
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <nav aria-label="Attendance views" className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-surface-muted p-1">
        {VIEWS.map(({ id, label, icon: Icon }) => {
          const params = new URLSearchParams(searchParams);
          params.set("view", id);
          return <Link
            key={id}
            to={`/analytics/attendance?${params.toString()}`}
            aria-current={selected.id === id ? "page" : undefined}
            className={cn("inline-flex min-h-9 items-center gap-2 rounded-md px-3 py-1.5 text-xs font-bold transition-colors sm:text-sm", selected.id === id ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          ><Icon aria-hidden="true" size={16} />{label}</Link>;
        })}
      </nav>
      {user?.role === "admin" && <Link to="/attendance/monthly-recap" className="inline-flex min-h-9 items-center px-2 text-xs font-semibold text-muted-foreground underline underline-offset-4 hover:text-foreground sm:text-sm">Monthly Recap Input</Link>}
    </div>
    <section aria-label={`${selected.label} attendance view`}>
      <Suspense fallback={<RouteLoadingFallback />}><ActiveView /></Suspense>
    </section>
  </div>;
}
