export function RouteLoadingFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="mx-auto mt-16 max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm"
    >
      <p className="text-base font-black text-slate-900">Loading page</p>
      <p className="mt-2 text-sm font-semibold text-slate-600">
        OperatorOS is preparing the requested workspace.
      </p>
    </div>
  );
}
