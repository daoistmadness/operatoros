import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'bun:test';

const root = join(import.meta.dir, '../..');
const validator = join(root, 'scripts/validate-oci-pr-checks.sh');
const roots: string[] = [];
const headSha = 'a'.repeat(40);
const repository = 'daoistmadness/operatoros';
const repositoryId = 1301262282;
const ciWorkflowId = 313505387;
const e2eWorkflowId = 316216305;
const ciRunId = 7001;
const e2eRunId = 7002;
const requiredChecks = [
  ['api', 'github-actions', ciRunId, 9001],
  ['frontend', 'github-actions', ciRunId, 9002],
  ['podman-images', 'github-actions', ciRunId, 9003],
  ['Select E2E scope', 'github-actions', e2eRunId, 9101],
  ['Ubuntu / Bun 1.4.2', 'github-actions', e2eRunId, 9102],
  ['CodeQL', 'github-advanced-security', null, null],
] as const;

afterAll(() => roots.forEach((path) => rmSync(path, { recursive: true, force: true })));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'operatoros-pr-checks-'));
  roots.push(dir);
  const files = {
    checks: join(dir, 'check-runs.json'),
    runs: join(dir, 'workflow-runs.json'),
    jobs: join(dir, 'workflow-jobs.json'),
    ciWorkflow: join(dir, 'ci-workflow.json'),
    e2eWorkflow: join(dir, 'e2e-workflow.json'),
  };
  const checks = requiredChecks.map(([name, app, runId, jobId], index) => ({
    id: index + 1,
    name,
    status: 'completed',
    conclusion: 'success',
    head_sha: headSha,
    created_at: '2026-10-14T10:00:00Z',
    completed_at: '2026-10-14T10:01:00Z',
    app: { slug: app },
    ...(runId && jobId ? { details_url: `https://github.com/${repository}/actions/runs/${runId}/job/${jobId}` } : {}),
  }));
  const workflowRun = (id: number, workflowId: number, path: string) => ({
    id,
    event: 'pull_request',
    path,
    workflow_id: workflowId,
    status: 'completed',
    conclusion: 'success',
    head_branch: 'codex/release-hardening',
    head_sha: headSha,
    run_attempt: 1,
    repository: { id: repositoryId, full_name: repository },
  });
  const jobs = requiredChecks.flatMap(([name, app, runId, jobId]) => runId && jobId && app === 'github-actions'
    ? [{ id: jobId, name, run_id: runId, run_attempt: 1, head_sha: headSha, status: 'completed', conclusion: 'success' }]
    : []);
  writeJson(files.checks, { total_count: checks.length, check_runs: checks });
  writeJson(files.runs, {
    workflow_runs: [
      workflowRun(ciRunId, ciWorkflowId, '.github/workflows/ci.yml'),
      workflowRun(e2eRunId, e2eWorkflowId, '.github/workflows/e2e-full.yml'),
    ],
  });
  writeJson(files.jobs, { jobs });
  writeJson(files.ciWorkflow, { id: ciWorkflowId, path: '.github/workflows/ci.yml', state: 'active' });
  writeJson(files.e2eWorkflow, { id: e2eWorkflowId, path: '.github/workflows/e2e-full.yml', state: 'active' });
  return { files, checks };
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value));
}

function writeChecks(file: string, checks: unknown[]) {
  writeJson(file, { total_count: checks.length, check_runs: checks });
}

function run(f: ReturnType<typeof fixture>, sha = headSha) {
  const result = Bun.spawnSync([
    'bash', validator,
    f.files.checks,
    f.files.runs,
    f.files.jobs,
    f.files.ciWorkflow,
    f.files.e2eWorkflow,
    sha,
    repository,
    String(repositoryId),
  ], { stdout: 'pipe', stderr: 'pipe', timeout: 10_000 });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function reject(f: ReturnType<typeof fixture>, message: string, sha = headSha) {
  const result = run(f, sha);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain(message);
}

test('OCI release check gate accepts required results from trusted workflows on the exact PR head', () => {
  const f = fixture();
  const result = run(f);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(`all 6 required pull request checks match head ${headSha}`);
});

test('OCI release check gate rejects a missing CodeQL result', () => {
  const f = fixture();
  writeChecks(f.files.checks, f.checks.filter(({ name }) => name !== 'CodeQL'));
  reject(f, 'required pull request check is missing');
});

test('OCI release check gate rejects failed and skipped required results', () => {
  for (const conclusion of ['failure', 'skipped']) {
    const f = fixture();
    const checks = structuredClone(f.checks);
    checks.find(({ name }) => name === 'podman-images')!.conclusion = conclusion;
    writeChecks(f.files.checks, checks);
    reject(f, 'required pull request check is missing, failed, skipped, or has the wrong source identity');
  }
});

test('OCI release check gate rejects a same-named result from an untrusted GitHub App', () => {
  const f = fixture();
  const checks = structuredClone(f.checks);
  checks.find(({ name }) => name === 'CodeQL')!.app.slug = 'github-actions';
  writeChecks(f.files.checks, checks);
  reject(f, 'required pull request check is missing, failed, skipped, or has the wrong source identity');
});

test('OCI release check gate rejects a check attached to a different commit', () => {
  const f = fixture();
  const checks = structuredClone(f.checks);
  checks.find(({ name }) => name === 'Ubuntu / Bun 1.4.2')!.head_sha = 'b'.repeat(40);
  writeChecks(f.files.checks, checks);
  reject(f, 'required pull request check is missing, failed, skipped, or has the wrong source identity');
});

test('OCI release check gate rejects a check from an unexpected workflow identity', () => {
  const f = fixture();
  const evidence = JSON.parse(readFileSync(f.files.runs, 'utf8')) as { workflow_runs: { workflow_id: number }[] };
  evidence.workflow_runs[0]!.workflow_id += 1;
  writeJson(f.files.runs, evidence);
  reject(f, 'required check is not bound to a successful trusted workflow run');
});

test('OCI release check gate rejects a workflow job not matching the check URL', () => {
  const f = fixture();
  const evidence = JSON.parse(readFileSync(f.files.jobs, 'utf8')) as { jobs: { id: number }[] };
  evidence.jobs[0]!.id += 1;
  writeJson(f.files.jobs, evidence);
  reject(f, 'required check is not bound to a successful job in the trusted run');
});

test('OCI release check gate rejects a failed source workflow even when a job is green', () => {
  const f = fixture();
  const evidence = JSON.parse(readFileSync(f.files.runs, 'utf8')) as { workflow_runs: { id: number; conclusion: string }[] };
  evidence.workflow_runs.find(({ id }) => id === ciRunId)!.conclusion = 'failure';
  writeJson(f.files.runs, evidence);
  reject(f, 'required check is not bound to a successful trusted workflow run');
});

test('OCI release check gate rejects a newer failed duplicate instead of accepting an older success', () => {
  const f = fixture();
  const checks = structuredClone(f.checks);
  checks.push({
    ...checks.find(({ name }) => name === 'CodeQL')!,
    id: 100,
    conclusion: 'failure',
    created_at: '2026-10-14T10:02:00Z',
    completed_at: '2026-10-14T10:03:00Z',
  });
  writeChecks(f.files.checks, checks);
  reject(f, 'required pull request check is missing, failed, skipped, or has the wrong source identity');
});

test('OCI release check gate rejects ambiguous latest results with equal timestamps', () => {
  const f = fixture();
  const checks = structuredClone(f.checks);
  checks.push({ ...checks.find(({ name }) => name === 'CodeQL')!, id: 101 });
  writeChecks(f.files.checks, checks);
  reject(f, 'required pull request check is missing, failed, skipped, or has the wrong source identity');
});

test('OCI release check gate rejects truncated check-run evidence', () => {
  const f = fixture();
  const evidence = JSON.parse(readFileSync(f.files.checks, 'utf8')) as { total_count: number; check_runs: unknown[] };
  evidence.total_count += 1;
  writeJson(f.files.checks, evidence);
  reject(f, 'pull request check evidence is incomplete or malformed');
});

test('OCI release check gate rejects a malformed SHA', () => {
  reject(fixture(), 'expected pull request head must be a full commit SHA', 'not-a-full-sha');
});
