import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'bun:test';

const root = join(import.meta.dir, '../..');
const validator = join(root, 'scripts/validate-oci-release-evidence.sh');
const roots: string[] = [];
const sourceCommit = 'a'.repeat(40);
const repository = 'daoistmadness/operatoros';
const repositoryId = 1301262282;
const workflowId = 313505387;
const ciRunId = 7001;
const fullReleaseRunId = 7002;
const artifactName = `operatoros-oci-${sourceCommit}-1`;

afterAll(() => roots.forEach((path) => rmSync(path, { recursive: true, force: true })));

function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value));
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'operatoros-release-evidence-'));
  roots.push(dir);
  const paths = {
    repository: join(dir, 'repository.json'),
    workflow: join(dir, 'workflow.json'),
    ciRun: join(dir, 'ci-run.json'),
    ciJobs: join(dir, 'ci-jobs.json'),
    artifacts: join(dir, 'artifacts.json'),
    fullRun: join(dir, 'full-release-run.json'),
    fullJobs: join(dir, 'full-release-jobs.json'),
  };

  writeJson(paths.repository, { id: repositoryId, full_name: repository, private: true });
  writeJson(paths.workflow, { id: workflowId, path: '.github/workflows/ci.yml', state: 'active' });
  writeJson(paths.ciRun, {
    id: ciRunId,
    event: 'push',
    head_branch: 'main',
    head_sha: sourceCommit,
    status: 'completed',
    conclusion: 'success',
    path: '.github/workflows/ci.yml',
    run_attempt: 1,
    workflow_id: workflowId,
    repository: { id: repositoryId, full_name: repository },
  });
  writeJson(paths.ciJobs, {
    total_count: 3,
    jobs: ['api', 'frontend', 'podman-images'].map((name, index) => ({
      id: index + 1,
      run_id: ciRunId,
      run_attempt: 1,
      head_sha: sourceCommit,
      name,
      status: 'completed',
      conclusion: 'success',
    })),
  });
  writeJson(paths.artifacts, {
    artifacts: [{
      id: 8101,
      name: artifactName,
      size_in_bytes: 1024,
      expired: false,
      digest: `sha256:${'b'.repeat(64)}`,
      workflow_run: {
        id: ciRunId,
        repository_id: repositoryId,
        head_repository_id: repositoryId,
        head_branch: 'main',
        head_sha: sourceCommit,
      },
    }],
  });
  writeJson(paths.fullRun, {
    id: fullReleaseRunId,
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: sourceCommit,
    status: 'completed',
    conclusion: 'success',
    path: '.github/workflows/ci.yml',
    run_attempt: 1,
    workflow_id: workflowId,
    repository: { id: repositoryId, full_name: repository },
  });
  writeJson(paths.fullJobs, {
    total_count: 1,
    jobs: [{
      id: 9101,
      run_id: fullReleaseRunId,
      run_attempt: 1,
      head_sha: sourceCommit,
      name: 'Full release validation',
      status: 'completed',
      conclusion: 'success',
    }],
  });

  const env = {
    ...process.env,
    SOURCE_COMMIT: sourceCommit,
    CI_RUN_ID: String(ciRunId),
    FULL_RELEASE_RUN_ID: String(fullReleaseRunId),
    GITHUB_REPOSITORY: repository,
    GITHUB_REPOSITORY_ID: String(repositoryId),
  };
  return { env, paths };
}

function run(f: ReturnType<typeof fixture>, extraEnv: Record<string, string> = {}) {
  const result = Bun.spawnSync(
    ['bash', validator, f.paths.repository, f.paths.workflow, f.paths.ciRun, f.paths.ciJobs, f.paths.artifacts, f.paths.fullRun, f.paths.fullJobs],
    { env: { ...f.env, ...extraEnv }, stdout: 'pipe', stderr: 'pipe', timeout: 10_000 },
  );
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function reject(f: ReturnType<typeof fixture>, message: string, extraEnv: Record<string, string> = {}) {
  const result = run(f, extraEnv);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain(message);
}

test('release evidence accepts matching trusted build, artifact, and Full release validation runs', () => {
  const f = fixture();
  const result = run(f);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe(`8101\t${artifactName}\tsha256:${'b'.repeat(64)}`);
});

test('release evidence rejects a missing explicit Full release run ID', () => {
  reject(fixture(), 'FULL_RELEASE_RUN_ID: FULL_RELEASE_RUN_ID is required', { FULL_RELEASE_RUN_ID: '' });
});

test('release evidence rejects a failed Full release workflow run', () => {
  const f = fixture();
  const fullRun = JSON.parse(readFileSync(f.paths.fullRun, 'utf8'));
  fullRun.conclusion = 'failure';
  writeJson(f.paths.fullRun, fullRun);
  reject(f, 'full_release_run_id is not a successful trusted full-release run');
});

test('release evidence rejects a skipped Full release validation job', () => {
  const f = fixture();
  const fullJobs = JSON.parse(readFileSync(f.paths.fullJobs, 'utf8'));
  fullJobs.jobs[0].conclusion = 'skipped';
  writeJson(f.paths.fullJobs, fullJobs);
  reject(f, 'Full release validation job did not complete successfully');
});

test('release evidence rejects a Full release run for a different source commit', () => {
  const f = fixture();
  const fullRun = JSON.parse(readFileSync(f.paths.fullRun, 'utf8'));
  fullRun.head_sha = 'c'.repeat(40);
  writeJson(f.paths.fullRun, fullRun);
  reject(f, 'full_release_run_id is not a successful trusted full-release run');
});

test('release evidence rejects expired artifact evidence as stale', () => {
  const f = fixture();
  const artifacts = JSON.parse(readFileSync(f.paths.artifacts, 'utf8'));
  artifacts.artifacts[0].expired = true;
  writeJson(f.paths.artifacts, artifacts);
  reject(f, 'OCI artifact is missing, expired, substituted, or not bound');
});

test('release evidence rejects an artifact substituted from another run', () => {
  const f = fixture();
  const artifacts = JSON.parse(readFileSync(f.paths.artifacts, 'utf8'));
  artifacts.artifacts[0].workflow_run.id = ciRunId + 99;
  writeJson(f.paths.artifacts, artifacts);
  reject(f, 'OCI artifact is missing, expired, substituted, or not bound');
});

test('release evidence rejects an artifact with a substituted source repository or revision', () => {
  const f = fixture();
  const artifacts = JSON.parse(readFileSync(f.paths.artifacts, 'utf8'));
  artifacts.artifacts[0].workflow_run.head_sha = 'd'.repeat(40);
  writeJson(f.paths.artifacts, artifacts);
  reject(f, 'OCI artifact is missing, expired, substituted, or not bound');
});

test('release evidence rejects a skipped or failed artifact-producing CI job', () => {
  const f = fixture();
  const jobs = JSON.parse(readFileSync(f.paths.ciJobs, 'utf8'));
  jobs.jobs[2].conclusion = 'skipped';
  writeJson(f.paths.ciJobs, jobs);
  reject(f, 'required artifact build job did not pass: podman-images');
});

test('release evidence rejects CI job records substituted from another run or commit', () => {
  for (const [field, value] of [['run_id', ciRunId + 1], ['head_sha', 'e'.repeat(40)]] as const) {
    const f = fixture();
    const jobs = JSON.parse(readFileSync(f.paths.ciJobs, 'utf8'));
    jobs.jobs[0][field] = value;
    writeJson(f.paths.ciJobs, jobs);
    reject(f, 'required artifact build job did not pass: api');
  }
});

test('release evidence rejects Full release job records substituted from another run or commit', () => {
  for (const [field, value] of [['run_id', fullReleaseRunId + 1], ['head_sha', 'f'.repeat(40)]] as const) {
    const f = fixture();
    const jobs = JSON.parse(readFileSync(f.paths.fullJobs, 'utf8'));
    jobs.jobs[0][field] = value;
    writeJson(f.paths.fullJobs, jobs);
    reject(f, 'Full release validation job did not complete successfully');
  }
});

test('release evidence rejects truncated CI and Full release job responses', () => {
  for (const key of ['ciJobs', 'fullJobs'] as const) {
    const f = fixture();
    const jobs = JSON.parse(readFileSync(f.paths[key], 'utf8'));
    jobs.total_count += 1;
    writeJson(f.paths[key], jobs);
    reject(f, 'workflow job evidence is incomplete or malformed');
  }
});

test('release evidence rejects a run whose workflow identity is not the repository CI workflow', () => {
  const f = fixture();
  const ciRun = JSON.parse(readFileSync(f.paths.ciRun, 'utf8'));
  ciRun.workflow_id = workflowId + 1;
  writeJson(f.paths.ciRun, ciRun);
  reject(f, 'ci_run_id is not a successful trusted main push');
});
