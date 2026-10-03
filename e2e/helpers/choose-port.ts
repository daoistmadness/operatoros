#!/usr/bin/env bun
/** Find a free loopback port in [start, end] without Python. */
import { parseArgs } from "node:util";
import { createServer } from "node:net";

function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

export async function choosePort(start: number, end: number): Promise<number> {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65535 || start > end)
    throw new TypeError("port range must satisfy 1 <= start <= end <= 65535");
  for (let port = start; port <= end; port++) if (await probe(port)) return port;
  throw new Error("no free E2E port");
}

if (import.meta.main) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {} });
    void values;
    if (positionals.length !== 2) throw new TypeError("usage: choose-port.ts <start> <end>");
    console.log(await choosePort(Number(positionals[0]), Number(positionals[1])));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof TypeError ? 2 : 1;
  }
}
