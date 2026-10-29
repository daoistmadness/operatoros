import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";

export function DeferredChart({ children, className }: { children: ReactNode; className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (nearViewport || !container.current) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "400px" });

    observer.observe(container.current);
    return () => observer.disconnect();
  }, [nearViewport]);

  return (
    <div ref={container} className={`w-full ${className ?? "h-[300px]"}`}>
      {nearViewport && (
        <Suspense
          fallback={
            <div role="status" className="flex h-full items-center justify-center text-sm text-slate-500">
              Loading chart…
            </div>
          }
        >
          {children}
        </Suspense>
      )}
    </div>
  );
}
