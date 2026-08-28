import { Type, type Static } from "@sinclair/typebox";

// Only schemas and types that cross an app or package boundary belong here.
// See docs/architecture/phase-14-monorepo.md.

export const LoginRequestSchema = Type.Object({
  username: Type.String({ minLength: 1, maxLength: 255 }),
  password: Type.String({ minLength: 1, maxLength: 1024 }),
});

export type LoginRequest = Static<typeof LoginRequestSchema>;

export const UserRoleSchema = Type.Union([
  Type.Literal("admin"),
  Type.Literal("staff"),
]);

export type UserRole = Static<typeof UserRoleSchema>;

export const AuthUserSchema = Type.Object({
  id: Type.Number({ minimum: 1 }),
  username: Type.String({ minLength: 1, maxLength: 255 }),
  role: UserRoleSchema,
  capabilities: Type.Array(Type.String()),
});

export type AuthUser = Static<typeof AuthUserSchema>;
