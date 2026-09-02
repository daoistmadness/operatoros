import { RefreshCw } from "lucide-react";
import { PageHeader } from "../../../components/common/page-header";
import { ErrorState, LoadingState } from "../../../components/common/state-message";
import { Button } from "../../../components/ui/button";
import { useAuth } from "../../../context/AuthContext";
import { FeatureReadinessCard, ReadinessChecklist } from "../components/ReadinessChecklist";
import { useReadinessQuery } from "../queries/useReadinessQuery";

export default function SetupReadiness() {
  const { user } = useAuth();
  const readiness = useReadinessQuery(user?.id ?? null);

  if (readiness.isPending) return <LoadingState title="Checking setup readiness" description="Reading canonical academic and operational configuration." />;
  if (readiness.isError || !readiness.data) return <ErrorState title="Setup readiness is unavailable" description="The readiness request failed. Setup has not been classified as incomplete." action={<Button variant="outline" onClick={() => void readiness.refetch()}><RefreshCw aria-hidden="true" className="size-4" />Retry readiness check</Button>} />;

  const machineImport = readiness.data.features.find((feature) => feature.key === "MACHINE_IMPORT");
  return <div className="space-y-7 pb-16">
    <PageHeader eyebrow="System setup" title="Setup & Readiness" description="See which canonical foundations are ready, which need action, and which workflows are available." actions={<Button variant="outline" onClick={() => void readiness.refetch()} disabled={readiness.isFetching}><RefreshCw aria-hidden="true" className="size-4" />Refresh</Button>} />
    <div className="rounded-xl border border-border bg-surface-muted/40 p-4" role="status" aria-live="polite">
      <p className="font-black text-foreground">{readiness.data.overall.summary}</p>
      <p className="mt-1 text-sm font-semibold text-muted-foreground">Overall state: {readiness.data.overall.state.replaceAll("_", " ")}</p>
    </div>
    <ReadinessChecklist items={readiness.data.foundation} />
    {machineImport && <section aria-labelledby="feature-readiness-title" className="space-y-4">
      <div><h2 id="feature-readiness-title" className="text-xl font-black text-foreground">Feature readiness</h2><p className="mt-1 text-sm font-semibold text-muted-foreground">Each workflow uses the same server-derived foundation state.</p></div>
      <FeatureReadinessCard feature={machineImport} />
    </section>}
  </div>;
}
