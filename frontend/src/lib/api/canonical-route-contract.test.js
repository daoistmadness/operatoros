import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(process.cwd(), 'src');
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    if (!sourceExtensions.has(path.extname(entry.name)) || entry.name.includes('.test.')) return [];
    return [fullPath];
  });
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

describe('canonical frontend API route contract', () => {
  it('rejects literal backend calls that bypass the /api namespace', () => {
    const violations = [];
    const literalCall = /\b(?:api\.(?:get|post|put|patch|delete)|fetch)\(\s*([`'"])(\/(?!api(?:\/|$))[^`'"]*)\1/g;
    const literalRequestPath = /\bapiRequest\(\s*\{[\s\S]{0,240}?\bpath:\s*([`'"])(\/(?!api(?:\/|$))[^`'"]*)\1/g;

    for (const file of sourceFiles(sourceRoot)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(literalCall)) {
        violations.push(`${path.relative(sourceRoot, file)}:${lineNumber(source, match.index)} ${match[2]}`);
      }
      for (const match of source.matchAll(literalRequestPath)) {
        violations.push(`${path.relative(sourceRoot, file)}:${lineNumber(source, match.index)} ${match[2]}`);
      }
    }

    expect(violations, `Noncanonical backend calls:\n${violations.join('\n')}`).toEqual([]);
  });

  it('contains no hardcoded local backend origin or double API prefix', () => {
    const violations = [];
    const forbidden = /https?:\/\/(?:127\.0\.0\.1|localhost):8000|\/api\/api\//g;

    for (const file of sourceFiles(sourceRoot)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(forbidden)) {
        violations.push(`${path.relative(sourceRoot, file)}:${lineNumber(source, match.index)} ${match[0]}`);
      }
    }

    expect(violations, `Hardcoded or doubled API routes:\n${violations.join('\n')}`).toEqual([]);
  });
});
