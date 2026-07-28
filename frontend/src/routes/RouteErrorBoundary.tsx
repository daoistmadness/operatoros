import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

type BoundaryProps = {
  children: ReactNode;
  locationKey: string;
  safePath?: string;
  safeLabel?: string;
};

type BoundaryState = {
  failed: boolean;
};

class RouteErrorBoundaryCore extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('A routed page failed to render.', error, info);
    }
  }

  componentDidUpdate(previousProps: BoundaryProps) {
    if (this.state.failed && previousProps.locationKey !== this.props.locationKey) {
      this.setState({ failed: false });
    }
  }

  private retry = () => {
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div role="alert" className="mx-auto mt-16 max-w-xl rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-2xl font-black text-slate-900">This page could not be loaded</h1>
        <p className="mt-2 text-sm font-semibold text-slate-600">
          The page encountered a temporary problem. Retry it, or return to a safe workspace.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={this.retry}
            className="min-h-11 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
          >
            Retry
          </button>
          <Link
            to={this.props.safePath ?? '/'}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
          >
            {this.props.safeLabel ?? 'Return to dashboard'}
          </Link>
        </div>
      </div>
    );
  }
}

type RouteErrorBoundaryProps = Omit<BoundaryProps, 'locationKey'>;

export function RouteErrorBoundary(props: RouteErrorBoundaryProps) {
  const location = useLocation();
  return <RouteErrorBoundaryCore {...props} locationKey={`${location.pathname}${location.search}`} />;
}
