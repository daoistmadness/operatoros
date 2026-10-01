import { Type, type Static } from "@sinclair/typebox";

export const HebOverrideWriteRequestSchema = Type.Object({
  heb_value: Type.Number(),
  note: Type.Optional(Type.String()),
}, { additionalProperties: false });

export type HebOverrideWriteRequest = Static<typeof HebOverrideWriteRequestSchema>;
