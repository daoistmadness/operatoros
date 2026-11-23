import { tmpdir } from "node:os";
import { join } from "node:path";

export function testTempPath(path: string): string {
  return join(tmpdir(), path);
}
