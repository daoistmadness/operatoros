import { useRef } from "react";
import { useUrlSearchParams as useSearchParams } from "../lib/router/search";
import { BellRing, CheckCircle2, Download, FileSpreadsheet, History, Search, UserRound, Users } from "lucide-react";
import { AppLink as Link } from "../components/AppLink";
import { useAuth } from "../context/AuthContext";
import { MachineImportWorkflow } from "../features/machine-import";
import { PageHeader } from "../components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { NeedsAttentionPanel } from "../components/upload/NeedsAttentionPanel";
import { UploadHistoryPanel } from "../components/upload/UploadHistoryPanel";
import { RosterImportPanel } from "../components/upload/RosterImportPanel";
import { StudentUpdatePanel } from "../components/upload/StudentUpdatePanel";
import DataPortability from "./DataPortability";

export default function UploadCenter() {
  const { can } = useAuth();
  const canImportStaff = can("import_staff");
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const sections = ["attendance", "roster", "student-update", "employee", "attention", "history", "export"] as const;
  const mode = sections.find((section) => section === requestedSection && (section !== "employee" || canImportStaff)) ?? "attendance";
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const setMode = (section: string) => {
    const nextMode = sections.find((value) => value === section);
    if (!nextMode || modeRef.current === nextMode) return;
    modeRef.current = nextMode;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextMode === "attendance") next.delete("section");
      else next.set("section", nextMode);
      return next;
    });
  };
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Data Management" title="Data Import & Export" description="Import operational school data, resolve issues, review history, and export supported datasets from one workspace." />
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList className={`grid h-auto w-full grid-cols-2 md:grid-cols-3 ${canImportStaff ? "xl:grid-cols-7" : "xl:grid-cols-6"}`}>
          <TabsTrigger value="attendance">
            <FileSpreadsheet className="mr-2 inline size-4" />
            Attendance Upload
          </TabsTrigger>
          <TabsTrigger value="roster">
            <Users className="mr-2 inline size-4" />
            Student Roster Upload
          </TabsTrigger>
          <TabsTrigger value="student-update">
            <CheckCircle2 className="mr-2 inline size-4" />
            Student Data Update
          </TabsTrigger>
          {canImportStaff && <TabsTrigger value="employee">
            <UserRound className="mr-2 inline size-4" />
            Employee Import
          </TabsTrigger>}
          <TabsTrigger value="attention">
            <BellRing className="mr-2 inline size-4" />
            Needs Attention
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-2 inline size-4" />
            History
          </TabsTrigger>
          <TabsTrigger value="export">
            <Download className="mr-2 inline size-4" />
            Export
          </TabsTrigger>
        </TabsList>
        <TabsContent value="attendance">
          <MachineImportWorkflow key={`attendance-${mode}`} embedded />
        </TabsContent>
        <TabsContent value="roster">
          <RosterImportPanel key={`roster-${mode}`} />
        </TabsContent>
        <TabsContent value="attention">
          <NeedsAttentionPanel enabled={mode === "attention"} />
        </TabsContent>
        <TabsContent value="history">
          <UploadHistoryPanel enabled={mode === "history"} />
        </TabsContent>
        <TabsContent value="student-update">
          <StudentUpdatePanel key={`student-update-${mode}`} />
        </TabsContent>
        {canImportStaff && <TabsContent value="employee">
          <Card>
            <CardHeader>
              <CardTitle>Employee Import</CardTitle>
              <p className="text-sm text-muted-foreground">
                Preview validates the Edelweiss worksheet and stages the source rows. Employee records change only after you commit the accepted rows.
              </p>
            </CardHeader>
            <CardContent>
              <Link className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" to="/staff/import">
                <UserRound className="size-4" />Open employee import
              </Link>
            </CardContent>
          </Card>
        </TabsContent>}
        <TabsContent value="export">
          <DataPortability embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
