import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";

function firstFieldSegment(path: string): string | undefined {
  const segment = path
    .replace(/^#/, "")
    .split("/")
    .filter(Boolean)[0];
  return segment?.replace(/~1/g, "/").replace(/~0/g, "~");
}

function toValidationResult<TData extends Record<string, unknown>>(
  errors: Iterable<{ path: string; message: string }>,
  value: TData,
) {
  const fields = Object.create(null) as Partial<Record<keyof TData, string>>;
  let form: string | undefined;

  for (const error of errors) {
    const field = firstFieldSegment(error.path);
    if (field && Object.hasOwn(value, field)) {
      const key = field as keyof TData;
      fields[key] = fields[key] ? `${fields[key]} ${error.message}` : error.message;
    } else {
      form ??= error.message;
    }
  }

  if (!form && Object.keys(fields).length === 0) return undefined;
  return { form, fields };
}

export function typeboxValidator<TData extends Record<string, unknown>>(schema: TSchema) {
  return (value: TData) => {
    if (Value.Check(schema, value)) return undefined;
    return toValidationResult(Value.Errors(schema, value), value);
  };
}
