import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'bun:test';

const root = resolve(import.meta.dir, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('native development stays separate from the optional rootless Podman path', () => {
  const mise = read('mise.toml');
  expect(mise).toContain('[tasks.dev]');
  expect(mise).toContain('[tasks."dev:api"]');
  expect(mise).toContain('[tasks."dev:web"]');
  expect(read('containers/dev-entrypoint.sh')).not.toContain('start-dev.sh');
});

test('persistent Quadlet lifecycle has one infrastructure owner', () => {
  const mise = read('mise.toml');
  for (const task of ['up', 'down', 'restart', 'rebuild', 'status', 'logs', 'quadlet:check', 'quadlet:install']) {
    expect(mise).not.toContain(`[tasks."podman:${task}"]`);
  }
  expect(existsSync(resolve(root, 'containers/quadlet/dev'))).toBe(false);
  expect(existsSync(resolve(root, 'scripts/podman-quadlet.sh'))).toBe(false);
  expect(read('docs/deployment/PODMAN_INTEGRATION.md')).toContain('only source for persistent host units');
});

test('direct development entrypoints are branch-independent and preserve native startup', () => {
  const entrypoint = read('containers/dev-entrypoint.sh');
  expect(entrypoint).toContain('exec bun --no-env-file run apps/api/src/server.ts');
  expect(entrypoint).toContain('vite/bin/vite.js --host');
  expect(entrypoint).not.toMatch(/start-dev\.sh|PRIMARY_CHECKOUT_UNEXPECTED_BRANCH|git branch/);
  expect(read('mise.toml')).toContain('[tasks.dev]');
  expect(read('mise.toml')).toContain('[tasks."dev:api"]');
  expect(read('mise.toml')).toContain('[tasks."dev:web"]');
});

test('development target remains separate from production OCI runtimes', () => {
  const containerfile = read('containers/Containerfile');
  expect(containerfile).toContain('FROM ${BUN_IMAGE} AS development-dependencies');
  expect(containerfile).toContain('RUN bun install --frozen-lockfile --linker=hoisted');
  expect(containerfile).toContain('test -e node_modules/vite/bin/vite.js');
  expect(containerfile).toContain('test -e node_modules/drizzle-orm/package.json');
  expect(containerfile).toContain('OPERATOROS_DEV_DEPENDENCY_LAYOUT=hoisted-v1');
  expect(containerfile).toContain('FROM ${BUN_RUNTIME_IMAGE} AS development');
  expect(containerfile).toContain('FROM api-runtime-dependencies AS api');
  expect(containerfile).toContain('FROM docker.io/nginxinc/nginx-unprivileged');
  expect(containerfile.indexOf('FROM ${BUN_RUNTIME_IMAGE} AS development')).toBeGreaterThan(containerfile.indexOf('FROM docker.io/nginxinc/nginx-unprivileged'));
});

test('containerized development seeds matching dependencies and keeps S4.8 smoke disposable', () => {
  const entrypoint = read('containers/dev-entrypoint.sh');
  const smoke = read('scripts/podman-dev-smoke.sh');
  expect(entrypoint).toContain('image_lock');
  expect(entrypoint).toContain('source_lock');
  expect(entrypoint).toContain('node_modules/.operatoros-image-lock');
  expect(entrypoint).toContain('OPERATOROS_DEV_DEPENDENCY_LAYOUT');
  expect(entrypoint).toContain('/workspace/operatoros-dependencies/node_modules/.');
  expect(entrypoint).toContain('Host-generated workspace dependencies exist');
  expect(entrypoint).toContain('for workspace in apps/api apps/web packages/contracts packages/db packages/excel packages/ui; do');
  expect(entrypoint).toContain('../../node_modules/vite/bin/vite.js');
  expect(entrypoint).toContain('OPERATOROS_DEV_BOOTSTRAP=true only for an explicitly disposable data root');
  expect(entrypoint.indexOf('cp -R /workspace/operatoros-dependencies/node_modules/.')).toBeLessThan(entrypoint.indexOf("exec bun --no-env-file run apps/api/src/server.ts"));
  expect(entrypoint).toContain('API did not seed matching development dependencies before the readiness deadline.');
  expect(smoke).toContain('20261002_s48');
  expect(smoke).toContain('VITE_HMR_PROTOCOL=wss');
  expect(smoke).toContain('VITE_HMR_CLIENT_PORT=8444');
  expect(smoke).toContain("test \"$unknown_host\" = 403");
  expect(smoke).toContain('101 Switching Protocols');
  const isolated = read('scripts/podman-dev-isolated-smoke.sh');
  expect(isolated).toContain('20261002_s48');
  expect(isolated).toContain('codex/primary-after');
  expect(isolated).toContain('synthetic worktrees');
  expect(isolated).toContain('deps-a/.operatoros-image-lock');
  expect(isolated).toContain('container entrypoint accepted host-generated workspace dependencies');
  expect(isolated).toContain('Host-generated workspace dependencies exist at packages/db/node_modules');
  expect(isolated).toContain('podman pod rm --force');
  expect(isolated).toContain('podman pod create --name "$pod_a" --userns=keep-id');
  expect(isolated).not.toContain(':U');
  expect(isolated).not.toContain('--pod "$pod" --userns=keep-id');
  expect(isolated).not.toContain('systemctl');
  expect(isolated).not.toContain('tailscale serve');
  const liveSmoke = read('scripts/podman-dev-smoke.sh');
  expect(liveSmoke).toContain('git clone --quiet --shared --no-checkout "$root" "$source"');
  expect(liveSmoke).toContain('git -C "$root" status --porcelain --untracked-files=normal');
  expect(liveSmoke).toContain('-v "$source:/workspace/operatoros:ro"');
});

test('OCI health checks are enforced by Podman smoke where the runtime can represent them', () => {
  const smoke = read('scripts/podman-ci.sh');
  expect(smoke.match(/--health-cmd/g)).toHaveLength(2);
  expect(smoke).toContain('grep -Eq');
  expect(smoke).not.toMatch(/\brg\s+-q/);
  expect(smoke).toContain('podman inspect -f \'{{.State.Health.Status}}\' "$api_name")" = healthy ]');
  expect(smoke).toContain('podman inspect -f \'{{.State.Health.Status}}\' "$web_name")" = healthy ]');
});

test('application verification does not control persistent services or live Tailscale', () => {
  const mise = read('mise.toml');
  const verify = mise.split('[tasks."podman:verify"]')[1]?.split('\n[')[0] ?? '';
  expect(verify).toContain('scripts/podman-ci.sh build');
  expect(verify).toContain('scripts/podman-ci.sh smoke');
  expect(verify).not.toContain('podman-dev-smoke');
  expect(verify).not.toContain('systemctl');
});

test('OCI CI builds the reviewed definitions and keeps PR/merge-group jobs credential-free', () => {
  const workflow = read('.github/workflows/ci.yml');
  const podmanJob = workflow.split('  podman-images:')[1]?.split('\n  release:')[0] ?? '';
  expect(workflow).toContain('  merge_group:');
  expect(podmanJob).toContain("github.event_name == 'merge_group'");
  expect(podmanJob).toContain('needs: [api, frontend]');
  expect(podmanJob).toContain('runs-on: ubuntu-26.04');
  expect(podmanJob).toContain('mise run podman:build');
  expect(podmanJob).toContain('mise run podman:smoke');
  expect(podmanJob).toContain('mise run podman:security');
  expect(podmanJob).toContain('20261002_s48');
  expect(podmanJob).not.toContain('packages: write');
  expect(podmanJob).not.toMatch(/docker\.sock|docker (run|build|login|push)/i);
  expect(podmanJob).toContain('sha256sum operatoros-api.oci operatoros-web.oci operatoros-api.cdx.json operatoros-web.cdx.json');
  expect(workflow).not.toContain('publish-ghcr:');
  const publish = read('.github/workflows/publish-oci.yml');
  expect(publish).toContain('workflow_dispatch:');
  expect(publish).toContain('full_release_run_id:');
  expect(publish).toContain('FULL_RELEASE_RUN_ID: ${{ inputs.full_release_run_id }}');
  expect(publish).toContain('scripts/validate-oci-release-evidence.sh');
  expect(publish).toContain('artifact-digest: ${{ steps.validate.outputs.artifact-digest }}');
  expect(publish).toContain('artifact-ids: ${{ needs.validate.outputs.artifact-id }}');
  expect(publish).toContain('Verified Full release validation run:');
  expect(publish).not.toMatch(/^\s+(pull_request|push|merge_group):/m);
  expect(publish).toContain('actions: read');
  expect(publish).toContain('packages: write');
  expect(publish).toContain('attestations: write');
  expect(publish).toContain('artifact-metadata: write');
  expect(publish).toContain('GH_TOKEN: ${{ github.token }}');
  expect(publish).not.toContain('secrets.GHCR');
  expect(publish).toContain('podman login --compat-auth-file "$auth_dir/config.json"');
  const attestVerify = publish.indexOf('Verify provenance and CycloneDX attestations from GHCR');
  const releaseMetadata = publish.indexOf('Package versioned release manifest and SBOMs');
  expect(attestVerify).toBeGreaterThan(-1);
  expect(attestVerify).toBeLessThan(releaseMetadata);
  const verifyStep = publish.split('      - name: Verify provenance and CycloneDX attestations from GHCR')[1]?.split('      - name: Package versioned release manifest and SBOMs')[0] ?? '';
  expect(verifyStep).toContain('GH_TOKEN: ${{ github.token }}');
  expect(verifyStep).toContain('DOCKER_CONFIG: ${{ runner.temp }}/operatoros-ghcr-docker-config');
  expect(verifyStep).toContain('for image_ref in "$API_REF" "$WEB_REF"; do');
  expect(verifyStep).toContain('gh attestation verify "oci://$image_ref"');
  expect(verifyStep).toContain('--bundle-from-oci');
  expect(verifyStep).toContain('--predicate-type https://cyclonedx.org/bom');
  expect(verifyStep).toContain('--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/publish-oci.yml"');
  const release = read('scripts/publish-oci-release.sh');
  expect(release).toContain('ghcr.io/daoistmadness/operatoros-api');
  expect(release).toContain('ghcr.io/daoistmadness/operatoros-web');
  const publisher = publish.split('\n  publish:\n')[1] ?? '';
  expect(publisher).toContain('environment:\n      name: oci-publish');
  expect(publish).toContain('vars.OPERATOROS_ENABLE_GHCR_PUBLISH');
  expect(publish).toContain('needs.validate.outputs.publish-enabled == \'true\'');
  expect(publish).toContain('GITHUB_EVENT_NAME" == workflow_dispatch');
  expect(publish).toContain('pull-requests: read');
  expect(publish).not.toContain('reviews_json');
  expect(publish).not.toContain('independent approval');
  expect(publish).toContain('source commit must be the merge commit');
  expect(publish).toContain("'Ubuntu / Bun 1.4.2'");
  expect(publish).toContain("'Select E2E scope'");
  expect(publish).toContain('checks: read');
  expect(publish).toContain('sudo apt-get install --yes podman skopeo');
  expect(publish).toContain('scripts/publish-oci-release.sh');
  expect(release).toContain('skopeo copy --quiet --preserve-digests');
  expect(release).toContain('sha256sum --check --strict oci-archives.sha256');
  expect(release).toContain('podman pull --quiet --authfile "$AUTH_FILE" "$ref"');
  expect(release).toContain('grep -Fqx "$ref"');
  const firstCopy = release.indexOf('skopeo copy --quiet --preserve-digests');
  for (const validation of [
    'podman load --input operatoros-api.oci',
    'podman load --input operatoros-web.oci',
    'podman image exists "localhost/operatoros-api:ci-${SOURCE_COMMIT}"',
    'podman image exists "localhost/operatoros-web:ci-${SOURCE_COMMIT}"',
  ]) expect(release.indexOf(validation)).toBeLessThan(firstCopy);
  expect(release).toContain('manifestVersion: 2');
  expect(release).toContain('ciRunId: $ci_run_id');
  expect(release).toContain('20261002_s48');
  expect(release).not.toContain('podman push');
  expect(publish.match(/uses: actions\/attest@/g)).toHaveLength(4);
  expect(read('.containerignore')).toMatch(/\.env/);
  expect(read('.containerignore')).toMatch(/node_modules/);
});

test('OCI security scans build output without a Podman or Docker socket', () => {
  const scanner = read('scripts/podman-security.sh');
  expect(scanner).toContain('podman save --format oci-dir');
  expect(scanner).toContain('--input "$image_layout"');
  expect(scanner).not.toContain('--image-src podman');
  expect(scanner).not.toContain('--docker-host');
});

test('deployment planning requires digest-pinned S4.8 release images and live apply remains gated', () => {
  const deploy = read('scripts/deploy.sh');
  expect(deploy).toContain('OPERATOROS_RELEASE_MANIFEST');
  expect(deploy).toContain('OPERATOROS_DEPLOY_ENV');
  expect(deploy).toContain('20261002_s48');
  expect(deploy).toContain('ghcr\\.io/daoistmadness/operatoros-api@sha256:');
  expect(deploy).toContain('ghcr\\.io/daoistmadness/operatoros-web@sha256:');
  expect(deploy).toContain('Remote apply is unavailable');
  expect(read('scripts/podman-rollback-smoke.sh')).toContain('Injected candidate pull failure');
});
