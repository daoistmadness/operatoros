export function hashPasswordSync(password: string): string {
  return Bun.password.hashSync(password, "argon2id");
}

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, "argon2id");
}

export function verifyPasswordSync(password: string, passwordHash: string): boolean {
  return Bun.password.verifySync(password, passwordHash);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return Bun.password.verify(password, passwordHash);
}
