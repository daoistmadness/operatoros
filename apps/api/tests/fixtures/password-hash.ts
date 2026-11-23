const hashes = new Map<string, string>();

export function testPasswordHash(password: string): string {
  let hash = hashes.get(password);
  if (!hash) {
    hash = Bun.password.hashSync(password, "argon2id");
    hashes.set(password, hash);
  }
  return hash;
}
