import { Button } from "@/components/ui/button";

export function FormErrorSummary({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" aria-live="assertive" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
      {message}
    </p>
  );
}

export function SubmitButton({
  pending,
  children,
  pendingLabel = "Saving…",
}: {
  pending: boolean;
  children: string;
  pendingLabel?: string;
}) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
