export default function NotFoundPage() {
  return (
    <div role="alert" className="mx-auto mt-16 max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center">
      <h1 className="text-2xl font-black text-slate-900">Page not found</h1>
      <p className="mt-2 text-sm font-semibold text-slate-500">The requested route does not exist.</p>
    </div>
  );
}
