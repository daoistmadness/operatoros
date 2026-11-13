import { randomBytes } from "node:crypto";
import { Algorithm, hash, hashSync, verify, verifySync } from "@node-rs/argon2";

const ARGON2ID_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65_536,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

function options() {
  return { ...ARGON2ID_OPTIONS, salt: randomBytes(32) };
}

export function hashPasswordSync(password: string): string {
  return hashSync(password, options());
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, options());
}

export function verifyPasswordSync(password: string, passwordHash: string): boolean {
  return verifySync(passwordHash, password);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return verify(passwordHash, password);
}
