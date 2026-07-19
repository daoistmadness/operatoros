import React, { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../dialog";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "../alert-dialog";

const migratedTitles = [
  "Override Attendance Status",
  "Add Manual Student",
  "Isi semua kelas Primary",
  "Create Academic Intervention",
  "Export Settings",
];

function DialogHarness({ title }: { title: string }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <button type="button" onClick={() => setOpen(true)}>Open {title}</button>
    <DialogContent>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>Focused task context.</DialogDescription>
      <input aria-label={`${title} first field`} />
      <button type="button" onClick={() => setOpen(false)}>Cancel</button>
    </DialogContent>
  </Dialog>;
}

afterEach(() => { document.body.innerHTML = ""; });

describe.each(migratedTitles)("migrated dialog: %s", (title) => {
  it("opens with announced context, traps focus, closes with Escape, and restores focus", async () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<DialogHarness title={title} />));
    const trigger = document.querySelector(`button`) as HTMLButtonElement;
    trigger.focus();
    await act(async () => trigger.click());
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain(title);
    await act(async () => await Promise.resolve());
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => await Promise.resolve());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => root.unmount());
  });
});

it("keeps a destructive error readable and prevents duplicate pending submission", async () => {
  const submit = vi.fn();
  function Harness() {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");
    return <AlertDialog open onOpenChange={() => undefined}>
      <AlertDialogContent>
        <AlertDialogTitle>Delete KKM threshold?</AlertDialogTitle>
        <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        {error ? <p role="alert">{error}</p> : null}
        <button type="button" disabled={pending} onClick={() => { submit(); setPending(true); setError("Request failed; try again."); }}>Delete threshold</button>
        <button type="button">Cancel</button>
      </AlertDialogContent>
    </AlertDialog>;
  }
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Harness />));
  const action = document.querySelector('button[disabled]') as HTMLButtonElement | null;
  expect(action).toBeNull();
  const deleteButton = [...document.querySelectorAll("button")].find(button => button.textContent === "Delete threshold") as HTMLButtonElement;
  await act(async () => deleteButton.click());
  expect(deleteButton.disabled).toBe(true);
  await act(async () => deleteButton.click());
  expect(submit).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Request failed");
  expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
  await act(async () => root.unmount());
});
