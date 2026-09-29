import { Navigate, useLocation } from "react-router-dom";

export function AttendanceCompatibilityRedirect({ view }: { view: "report" | "recap" | "tardiness" }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("view", view);
  return <Navigate replace to={{ pathname: "/analytics/attendance", search: `?${params.toString()}`, hash: location.hash }} />;
}
