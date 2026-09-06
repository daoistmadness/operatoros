import { useState } from "react";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import type { AssessmentComponent, Subject } from "../../types/grade";

type ComponentType = AssessmentComponent["assessment_type"];

interface AssessmentComponentsPanelProps {
  components: AssessmentComponent[];
  subject: Subject | null;
  isLoading?: boolean;
  error?: string;
  onCreate: (payload: { name: string; assessment_type: ComponentType; subject_id: number | null }) => Promise<void>;
  onUpdate: (id: number, payload: { name?: string; assessment_type?: ComponentType; subject_id?: number | null }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export default function AssessmentComponentsPanel({ components, subject, isLoading = false, error, onCreate, onUpdate, onDelete }: AssessmentComponentsPanelProps) {
  const [name, setName] = useState("");
  const [assessmentType, setAssessmentType] = useState<ComponentType>("sumatif");
  const [editing, setEditing] = useState<AssessmentComponent | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const visible = subject ? components.filter((component) => component.subject_id === null || component.subject_id === subject.id) : [];
  const scoped = visible.filter((component) => component.subject_id === subject?.id);

  const reset = () => {
    setName("");
    setAssessmentType("sumatif");
    setEditing(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!subject || !name.trim()) return;
    setPendingId(-1);
    try {
      if (editing) await onUpdate(editing.id, { name: name.trim(), assessment_type: assessmentType });
      else await onCreate({ name: name.trim(), assessment_type: assessmentType, subject_id: subject.id });
      reset();
    } catch {
      // The parent owns the user-facing API error state.
    } finally {
      setPendingId(null);
    }
  };

  const edit = (component: AssessmentComponent) => {
    setEditing(component);
    setName(component.name);
    setAssessmentType(component.assessment_type);
  };

  const remove = async (component: AssessmentComponent) => {
    if (!window.confirm(`Delete ${component.name}? Components with saved scores cannot be deleted.`)) return;
    setPendingId(component.id);
    try {
      await onDelete(component.id);
      if (editing?.id === component.id) reset();
    } catch {
      // The parent owns the user-facing API error state.
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Card aria-label="Assessment components">
      <CardHeader>
        <CardTitle>Assessment components</CardTitle>
        <p className="text-sm text-muted-foreground">Components are the score columns used by the selected subject in Grade Ledger.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {!subject ? <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Select a subject to configure its assessment components.</p> : null}
        {error ? <div role="alert" className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 size-4" />{error}</div> : null}
        {subject ? <form className="grid gap-3 rounded-md border border-border bg-surface-muted p-4 md:grid-cols-[1fr_10rem_auto_auto] md:items-end" onSubmit={submit}>
          <div><FieldLabel htmlFor="assessment-component-name">{editing ? "Component name" : "New component name"}</FieldLabel><Input id="assessment-component-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Midterm exam" maxLength={120} required /></div>
          <div><FieldLabel htmlFor="assessment-component-type">Type</FieldLabel><select id="assessment-component-type" value={assessmentType} onChange={(event) => setAssessmentType(event.target.value as ComponentType)} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"><option value="sumatif">Sumatif</option><option value="formatif">Formatif</option></select></div>
          <Button type="submit" disabled={!name.trim() || pendingId !== null}>{pendingId === -1 ? "Saving…" : editing ? "Save changes" : <><Plus className="size-4" />Add component</>}</Button>
          {editing ? <Button type="button" variant="outline" onClick={reset} disabled={pendingId !== null}>Cancel</Button> : null}
        </form> : null}
        {isLoading ? <p className="text-sm text-muted-foreground">Loading components…</p> : subject && visible.length === 0 ? <div className="rounded-md border border-dashed border-border p-4"><p className="font-semibold">This assessment has no components yet.</p><p className="mt-1 text-sm text-muted-foreground">Add the components students will receive scores for.</p></div> : null}
        {subject && !isLoading && visible.length > 0 ? <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Assessment components for {subject.name}</caption><thead><tr className="border-b border-border text-left"><th scope="col" className="py-2 pr-4">Component</th><th scope="col" className="py-2 pr-4">Type</th><th scope="col" className="py-2 pr-4">Scope</th><th scope="col" className="py-2">Actions</th></tr></thead><tbody>{visible.map((component) => <tr key={component.id} className="border-b border-border"><th scope="row" className="py-2 pr-4 text-left">{component.name}</th><td className="py-2 pr-4">{component.assessment_type === "sumatif" ? "Sumatif" : "Formatif"}</td><td className="py-2 pr-4">{component.subject_id === null ? "Shared" : subject.name}</td><td className="py-2"><div className="flex gap-2">{component.subject_id === subject.id ? <><Button type="button" size="sm" variant="outline" onClick={() => edit(component)} disabled={pendingId !== null}><Pencil className="size-3" />Edit</Button><Button type="button" size="sm" variant="outline" onClick={() => void remove(component)} disabled={pendingId !== null}><Trash2 className="size-3" />Delete</Button></> : <span className="text-xs text-muted-foreground">Inherited</span>}</div></td></tr>)}</tbody></table><p className="mt-3 text-xs text-muted-foreground">{scoped.length} subject-specific component{scoped.length === 1 ? "" : "s"}. Saved scores keep their component identity; structural changes are blocked after scoring.</p></div> : null}
      </CardContent>
    </Card>
  );
}
