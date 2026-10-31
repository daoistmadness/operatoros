export function AuthLoading() {
  return <div role="status" className="flex min-h-screen items-center justify-center bg-slate-50 font-bold text-slate-500">Checking your session…</div>;
}

export function SessionCheckUnavailable({ retry }: { retry: () => void }) {
  return (
    <section role="alert" className="mx-auto mt-20 max-w-xl rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center">
      <h1 className="text-2xl font-black text-amber-900">Session check unavailable</h1>
      <p className="mt-2 text-sm font-semibold text-amber-700">OperatorOS could not verify your session. Check the API connection and retry.</p>
      <button type="button" onClick={retry} className="mt-5 rounded-lg bg-amber-900 px-4 py-2 font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-900">
        Retry session check
      </button>
    </section>
  );
}

export function AccessDenied() {
  return (
    <div role="alert" className="mx-auto mt-20 max-w-xl rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center">
      <h1 className="text-2xl font-black text-amber-900">Access denied</h1>
      <p className="mt-2 text-sm font-semibold text-amber-700">Your account does not have permission to open this administrative area.</p>
    </div>
  );
}
