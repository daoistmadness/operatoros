import React from "react";
import { UploadHistoryPanel } from "../components/upload/UploadHistoryPanel";
import { PageHeader } from "../components/common/page-header";

function UploadHistory() {
  return <div className="space-y-6"><PageHeader eyebrow="Audit and reconciliation" title="Upload Evidence Center" description="Understand what was previewed, selected, committed, blocked, resolved, retried, or rolled back without replaying historical data." /><UploadHistoryPanel /></div>;
}

export default UploadHistory;
