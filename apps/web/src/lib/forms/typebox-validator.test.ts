import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { typeboxValidator } from "./typebox-validator";

describe("TypeBox form validator", () => {
  const schema = Type.Object({
    full_name: Type.String({ minLength: 1, maxLength: 5 }),
    email: Type.String({ pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" }),
  });
  const validate = typeboxValidator<{ full_name: string; email: string }>(schema);

  it("maps TypeBox property errors to their field and accepts valid values", () => {
    expect(validate({ full_name: "", email: "rina@example.com" })?.fields.full_name).toBeTruthy();
    expect(validate({ full_name: "Rina", email: "invalid" })?.fields.email).toBeTruthy();
    expect(validate({ full_name: "Rina", email: "rina@example.com" })).toBeUndefined();
  });
});
