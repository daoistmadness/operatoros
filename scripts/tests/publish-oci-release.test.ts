import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect, test } from 'bun:test';

const root = resolve(import.meta.dir, '../..');
const publisher = join(root, 'scripts/publish-oci-release.sh');
const artifactNames = ['operatoros-api.oci', 'operatoros-web.oci', 'operatoros-api.cdx.json', 'operatoros-web.cdx.json'];
const requiredFiles = [...artifactNames, 'oci-archives.sha256'];
const roots: string[] = [];

afterAll(() => roots.forEach((path) => rmSync(path, { recursive: true, force: true })));

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'operatoros-oci-release-test-'));
  roots.push(dir);
  const artifact = join(dir, 'artifact');
  const bin = join(dir, 'bin');
  const runnerTemp = join(dir, 'runner-temp');
  mkdirSync(artifact);
  mkdirSync(bin);
  mkdirSync(runnerTemp);

  for (const image of ['api', 'web']) {
    const layout = join(artifact, `${image}-layout`);
    const blobs = join(layout, 'blobs/sha256');
    mkdirSync(blobs, { recursive: true });
    const manifest = JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: `sha256:${'1'.repeat(64)}`, size: 0 }, layers: [] });
    const digest = sha256(manifest);
    writeFileSync(join(blobs, digest), manifest);
    writeFileSync(join(layout, 'index.json'), JSON.stringify({ schemaVersion: 2, manifests: [{ mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: `sha256:${digest}`, size: Buffer.byteLength(manifest) }] }));
    const archive = `operatoros-${image}.oci`;
    const tar = Bun.spawnSync(['tar', '-cf', join(artifact, archive), 'index.json', `blobs/sha256/${digest}`], { cwd: layout, stdout: 'pipe', stderr: 'pipe' });
    if (tar.exitCode !== 0) throw new Error(tar.stderr.toString());
  }

  for (const name of ['operatoros-api.cdx.json', 'operatoros-web.cdx.json']) {
    writeFileSync(join(artifact, name), JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6', version: 1, components: [] }));
  }
  const authFile = join(dir, 'auth.json');
  const output = join(dir, 'github-output');
  const podmanLog = join(dir, 'podman.log');
  const skopeoLog = join(dir, 'skopeo.log');
  writeFileSync(authFile, '{}');
  writeFileSync(output, '');
  writeFileSync(podmanLog, '');
  writeFileSync(skopeoLog, '');
  writeChecksums(artifact, artifactNames);

  writeFileSync(join(bin, 'podman'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$TEST_PODMAN_LOG"
case "\${1:-}" in
  info) if [[ "\${3:-}" == '{{.Host.Security.Rootless}}' ]]; then echo true; else echo 'version=5.7.0 rootless=true storage=test'; fi ;;
  image) if [[ "\${2:-}" == inspect ]]; then printf '%s\\n' "\${3:-}"; fi ;;
esac
`);
  writeFileSync(join(bin, 'skopeo'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$TEST_SKOPEO_LOG"
digest_file=''
destination=''
while (($#)); do
  case "$1" in
    --digestfile) digest_file="$2"; shift 2 ;;
    --authfile) shift 2 ;;
    --quiet|--preserve-digests) shift ;;
    *) destination="$1"; shift ;;
  esac
done
if [[ "\${MOCK_SKOPEO_FAIL:-}" == web && "$destination" == *operatoros-web* ]]; then exit 23; fi
digest="\${destination##*@}"
if [[ "\${MOCK_SKOPEO_MISMATCH:-}" == api && "$destination" == *operatoros-api* ]]; then digest='sha256:${'0'.repeat(64)}'; fi
if [[ "\${MOCK_SKOPEO_MISMATCH:-}" == web && "$destination" == *operatoros-web* ]]; then digest='sha256:${'0'.repeat(64)}'; fi
printf '%s\\n' "$digest" > "$digest_file"
`);
  chmodSync(join(bin, 'podman'), 0o755);
  chmodSync(join(bin, 'skopeo'), 0o755);

  const env = {
    ...process.env,
    AUTH_FILE: authFile,
    CI_RUN_ID: '38236422556',
    GITHUB_OUTPUT: output,
    PATH: `${bin}:${process.env.PATH}`,
    RELEASE_VERSION: '1.2.3',
    RUNNER_TEMP: runnerTemp,
    SOURCE_COMMIT: 'a'.repeat(40),
    TEST_PODMAN_LOG: podmanLog,
    TEST_SKOPEO_LOG: skopeoLog,
  };

  return { artifact, env, output, podmanLog, runnerTemp, skopeoLog };
}

function writeChecksums(artifact: string, names: string[]) {
  const lines = names.map((name) => `${sha256(readFileSync(join(artifact, name)))}  ${name}`);
  writeFileSync(join(artifact, 'oci-archives.sha256'), `${lines.join('\n')}\n`);
}

function run(f: ReturnType<typeof fixture>, extraEnv: Record<string, string> = {}) {
  return Bun.spawnSync(['bash', publisher], {
    cwd: f.artifact,
    env: { ...f.env, ...extraEnv },
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
  });
}

function expectPrePushFailure(f: ReturnType<typeof fixture>, message: string) {
  const result = run(f);
  expect(result.exitCode).not.toBe(0);
  expect(`${result.stdout.toString()}${result.stderr.toString()}`).toContain(message);
  expect(readFileSync(f.podmanLog, 'utf8')).toBe('');
  expect(readFileSync(f.skopeoLog, 'utf8')).toBe('');
}

for (const name of requiredFiles) {
  test(`release publisher fails before container or registry operations when ${name} is missing`, () => {
    const f = fixture();
    rmSync(join(f.artifact, name));
    expectPrePushFailure(f, 'required artifact is missing or empty');
  });

  test(`release publisher fails before container or registry operations when ${name} is empty`, () => {
    const f = fixture();
    writeFileSync(join(f.artifact, name), '');
    expectPrePushFailure(f, 'required artifact is missing or empty');
  });
}

test('release publisher rejects an omitted checksum entry before loading images', () => {
  const f = fixture();
  writeChecksums(f.artifact, artifactNames.slice(1));
  expectPrePushFailure(f, 'checksum file must list exactly');
});

test('release publisher rejects an extra checksum entry before loading images', () => {
  const f = fixture();
  writeFileSync(join(f.artifact, 'unexpected.txt'), 'unexpected');
  writeChecksums(f.artifact, [...artifactNames, 'unexpected.txt']);
  expectPrePushFailure(f, 'checksum file must list exactly');
});

test('release publisher rejects a checksum mismatch before loading images', () => {
  const f = fixture();
  writeFileSync(join(f.artifact, 'operatoros-api.oci'), 'tampered');
  expectPrePushFailure(f, 'FAILED');
});

test('release publisher rejects registry digest mismatch without creating a manifest', () => {
  const f = fixture();
  const result = run(f, { MOCK_SKOPEO_MISMATCH: 'api' });
  expect(result.exitCode).not.toBe(0);
  expect(`${result.stdout.toString()}${result.stderr.toString()}`).toContain('registry digest differs');
  expect(existsSync(join(f.runnerTemp, 'operatoros-release-manifest.json'))).toBe(false);
});

test('release manifest is created only after both images pass digest pull verification', () => {
  const f = fixture();
  const result = run(f, { MOCK_SKOPEO_FAIL: 'web' });
  expect(result.exitCode).not.toBe(0);
  expect(existsSync(join(f.runnerTemp, 'operatoros-release-manifest.json'))).toBe(false);
  const podmanCalls = readFileSync(f.podmanLog, 'utf8');
  expect(podmanCalls).toContain('pull --quiet --authfile');
  expect(readFileSync(f.skopeoLog, 'utf8')).toContain('operatoros-web');
});

test('successful release manifest records version 2, source commit, CI run, and digest refs', () => {
  const f = fixture();
  const result = run(f);
  expect(result.exitCode).toBe(0);
  const manifest = JSON.parse(readFileSync(join(f.runnerTemp, 'operatoros-release-manifest.json'), 'utf8'));
  expect(manifest.manifestVersion).toBe(2);
  expect(manifest.sourceCommit).toBe('a'.repeat(40));
  expect(manifest.ciRunId).toBe('38236422556');
  expect(manifest.schema).toBe('20261002_s48');
  expect(manifest.images.api).toMatch(/^ghcr\.io\/daoistmadness\/operatoros-api@sha256:[a-f0-9]{64}$/);
  expect(manifest.images.web).toMatch(/^ghcr\.io\/daoistmadness\/operatoros-web@sha256:[a-f0-9]{64}$/);
  const outputs = readFileSync(f.output, 'utf8');
  expect(outputs).toContain(`api-digest=${manifest.images.api.split('@')[1]}`);
  expect(outputs).toContain(`web-digest=${manifest.images.web.split('@')[1]}`);
  expect(readFileSync(f.skopeoLog, 'utf8')).toMatch(/docker:\/\/ghcr\.io\/daoistmadness\/operatoros-api@sha256:/);
  expect(readFileSync(f.skopeoLog, 'utf8')).toMatch(/docker:\/\/ghcr\.io\/daoistmadness\/operatoros-web@sha256:/);
});
