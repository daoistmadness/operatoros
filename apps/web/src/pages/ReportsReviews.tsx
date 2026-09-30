import { lazy, Suspense } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { LoadingState } from "../components/common/state-message";
import { useAuth } from "../context/AuthContext";

const MonthlyReport = lazy(() => import("./MonthlyReport"));
const AnnualReport = lazy(() => import("./ExecutiveReports"));
const TermReview = lazy(() => import("./ManagementReviewStudentProfile"));
type ReportView = "monthly" | "annual" | "term-review";

export default function ReportsReviews() {
  const [search] = useSearchParams();
  const { can } = useAuth();
  const requested = search.get("view") ?? "monthly";
  if (!["monthly", "annual", "term-review"].includes(requested)) return <Navigate replace to="/reports?view=monthly" />;
  const view = requested as ReportView;
  if (view === "term-review" && !can("view_student")) return <Navigate replace to="/reports?view=monthly" />;

  const destination = (nextView: ReportView) => {
    const params = new URLSearchParams(nextView === "term-review" ? search : undefined);
    params.set("view", nextView);
    return `/reports?${params.toString()}`;
  };
  const views: { id: ReportView; label: string }[] = [
    { id: "monthly", label: "Monthly" }, { id: "annual", label: "Annual" },
    ...(can("view_student") ? [{ id: "term-review" as const, label: "Term Review" }] : []),
  ];

  return <div className="space-y-6">
    <header>
      <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">Reports &amp; Reviews</h1>
      <nav aria-label="Report views" className="mt-4 flex flex-wrap gap-2 border-b border-slate-200">
        {views.map((item) => <Link key={item.id} to={destination(item.id)} aria-current={view === item.id ? "page" : undefined}
          className={`border-b-2 px-3 py-2 text-sm font-bold ${view === item.id ? "border-brand text-brand" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          {item.label}
        </Link>)}
      </nav>
    </header>
    <Suspense fallback={<LoadingState title="Loading report" />}>
      {view === "monthly" ? <MonthlyReport /> : view === "annual" ? <AnnualReport /> : <TermReview />}
    </Suspense>
  </div>;
}
