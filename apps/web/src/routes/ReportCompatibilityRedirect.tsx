import { Navigate, useLocation } from "react-router-dom";

export function ReportCompatibilityRedirect({ view }: { view: "monthly" | "annual" | "term-review" }) {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  search.set("view", view);
  return <Navigate replace to={{ pathname: "/reports", search: `?${search.toString()}`, hash: location.hash }} />;
}
