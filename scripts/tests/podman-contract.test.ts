import { readFileSync } from 'node:fs';
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

test('persistent development units build from source and avoid mutable branch checks', () => {
  const api = read('containers/quadlet/dev/operatoros-dev.container');
  const web = read('containers/quadlet/dev/operatoros-dev-web.container');
  const pod = read('containers/quadlet/dev/operatoros-dev.pod');
  expect(api).toContain('Image=operatoros-dev.build');
  expect(web).toContain('Image=operatoros-dev.build');
  expect(api).toContain('Pod=operatoros-dev.pod');
  expect(api).toContain('Exec=/usr/local/bin/operatoros-dev-entrypoint api');
  expect(web).toContain('Exec=/usr/local/bin/operatoros-dev-entrypoint web');
  expect(`${api}\n${web}`).not.toMatch(/start-dev\.sh|PRIMARY_CHECKOUT_UNEXPECTED_BRANCH/);
  expect(pod).toContain('Network=slirp4netns');
  expect(pod).toContain('PublishPort=127.0.0.1:5173:5173');
  expect(read('scripts/podman-quadlet.sh')).toContain("[ \"${2:-}\" = --apply ]");
});

test('containerized development seeds exact lockfile dependencies and preserves S4.8 data', () => {
  const entrypoint = read('containers/dev-entrypoint.sh');
  const smoke = read('scripts/podman-dev-smoke.sh');
  expect(entrypoint).toContain('image_lock');
  expect(entrypoint).toContain('source_lock');
  expect(entrypoint).toContain('node_modules/.operatoros-image-lock');
  expect(entrypoint.indexOf('cp -R --no-preserve=ownership')).toBeLessThan(entrypoint.indexOf("exec bun --no-env-file run apps/api/src/server.ts"));
  expect(entrypoint).toContain('API did not seed matching development dependencies before the readiness deadline.');
  expect(smoke).toContain('20261002_s48');
  expect(smoke).toContain('VITE_HMR_PROTOCOL=wss');
  expect(smoke).toContain('VITE_HMR_CLIENT_PORT=8444');
  expect(smoke).toContain("test \"$unknown_host\" = 403");
  expect(smoke).toContain('101 Switching Protocols');
});

test('OCI health checks are enforced by the runtime that can represent them', () => {
  const api = read('containers/quadlet/dev/operatoros-dev.container');
  const web = read('containers/quadlet/dev/operatoros-dev-web.container');
  const smoke = read('scripts/podman-ci.sh');
  expect(api).toContain('HealthCmd=/usr/local/bin/operatoros-dev-healthcheck api');
  expect(web).toContain('HealthCmd=/usr/local/bin/operatoros-dev-healthcheck web');
  expect(smoke.match(/--health-cmd/g)).toHaveLength(2);
  expect(smoke).toContain('grep -Eq');
  expect(smoke).not.toMatch(/\brg\s+-q/);
  expect(smoke).toContain('podman inspect -f \'{{.State.Health.Status}}\' "$api_name")" = healthy ]');
  expect(smoke).toContain('podman inspect -f \'{{.State.Health.Status}}\' "$web_name")" = healthy ]');
});

test('lifecycle commands preserve named data and only touch OperatorOS units', () => {
  const mise = read('mise.toml');
  const lifecycle = read('scripts/podman-quadlet.sh');
  for (const task of ['doctor', 'build', 'smoke', 'up', 'down', 'restart', 'rebuild', 'status', 'logs', 'verify', 'quadlet:check']) {
    expect(mise).toContain(`[tasks."podman:${task}"]`);
  }
  expect(lifecycle).toContain('operatoros-dev-data.volume');
  expect(lifecycle).not.toMatch(/podman\s+(system\s+)?prune|volume\s+rm/);
  expect(lifecycle).toContain('systemctl --user stop operatoros-dev-web.service operatoros-dev.service operatoros-dev-pod.service');
  expect(lifecycle).toContain('--unit=operatoros-dev.service');
  expect(lifecycle).not.toContain('--unit=operatoros-dev-api.service');
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
