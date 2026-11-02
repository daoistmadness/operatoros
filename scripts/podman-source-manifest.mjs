import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, readlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function git(root, args, input) {
  return execFileSync('git', args, { cwd: root, input, maxBuffer: 1024 * 1024 * 1024 });
}

export function assertCleanWorktree(root) {
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all', '-z']);
  if (status.length) {
    throw new Error(`Source worktree must be clean before validation: ${resolve(root)}`);
  }
}

function readGitObjects(root, objectIds) {
  const output = git(root, ['cat-file', '--batch'], Buffer.from(`${objectIds.join('\n')}\n`));
  const values = new Map();
  let offset = 0;
  for (const expectedId of objectIds) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error(`Missing Git object header for ${expectedId}`);
    const [objectId, type, rawSize] = output.subarray(offset, headerEnd).toString('ascii').split(' ');
    const size = Number(rawSize);
    if (objectId !== expectedId || type !== 'blob' || !Number.isSafeInteger(size) || size < 0) {
      throw new Error(`Unexpected Git object response for ${expectedId}`);
    }
    const start = headerEnd + 1;
    const end = start + size;
    if (end >= output.length || output[end] !== 0x0a) throw new Error(`Truncated Git object ${expectedId}`);
    values.set(expectedId, output.subarray(start, end));
    offset = end + 1;
  }
  return values;
}

export function createSourceManifest(root) {
  assertCleanWorktree(root);
  const commit = git(root, ['rev-parse', 'HEAD']).toString('ascii').trim();
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']).toString('ascii').trim();
  const records = git(root, ['ls-tree', '-rz', '--full-tree', 'HEAD'])
    .toString('binary')
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf('\t');
      const [mode, type, objectId] = record.slice(0, separator).split(' ');
      const path = Buffer.from(record.slice(separator + 1), 'binary').toString('utf8');
      if (type !== 'blob') throw new Error(`Unsupported Git tree entry at ${path}: ${type}`);
      return { mode, objectId, path };
    });
  const blobs = readGitObjects(root, records.map(({ objectId }) => objectId));
  const files = records.map(({ mode, objectId, path }) => {
    const expected = blobs.get(objectId);
    if (!expected) throw new Error(`Git blob missing for ${path}`);
    const absolute = join(root, path);
    const metadata = lstatSync(absolute);
    const kind = mode === '120000' ? 'symlink' : 'file';
    if (kind === 'symlink' && !metadata.isSymbolicLink() || kind === 'file' && !metadata.isFile()) {
      throw new Error(`Checkout type differs from committed source at ${path}`);
    }
    if (kind === 'file' && Boolean(metadata.mode & 0o111) !== (mode === '100755')) {
      throw new Error(`Checkout executable bit differs from committed source at ${path}`);
    }
    const actual = kind === 'symlink' ? Buffer.from(readlinkSync(absolute)) : readFileSync(absolute);
    if (!actual.equals(expected)) throw new Error(`Checkout content differs from committed source at ${path}`);
    return {
      path,
      kind,
      mode: kind === 'symlink' ? 0o777 : Number.parseInt(mode, 8) & 0o777,
      size: actual.length,
      sha256: createHash('sha256').update(actual).digest('hex'),
    };
  });
  return { commit, tree, files };
}

function main(args) {
  const [command, root, output] = args;
  if (!['assert-clean', 'write-manifest'].includes(command) || !root || command === 'write-manifest' && !output) {
    throw new Error(`Usage: ${basename(process.argv[1])} assert-clean <repo> | write-manifest <repo> <output>`);
  }
  assertCleanWorktree(root);
  if (command === 'write-manifest') {
    const manifest = createSourceManifest(root);
    writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
