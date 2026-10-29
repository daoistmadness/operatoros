import type { FieldErrors } from "../api/errors";

export function mapServerFieldErrors<TData extends object>(
  fieldErrors: FieldErrors | null,
  allowedFields: readonly (keyof TData)[],
): Partial<Record<keyof TData, string>> {
  const allowed = new Set(allowedFields.map(String));
  const mapped = Object.create(null) as Partial<Record<keyof TData, string>>;

  for (const [path, messages] of Object.entries(fieldErrors ?? {})) {
    const segments = path.split(/[.[\]]+/).filter(Boolean);
    let field: string | undefined;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (allowed.has(segments[index]!)) {
        field = segments[index];
        break;
      }
    }
    if (!field) continue;

    const key = field as keyof TData;
    const message = messages.filter(Boolean).join(" ");
    if (message) mapped[key] = mapped[key] ? `${mapped[key]} ${message}` : message;
  }

  return mapped;
}
