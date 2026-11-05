import importlib.util
import io
import json
import os
from pathlib import Path
import pwd
import shutil
import sys
import tarfile
import tempfile
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('release', ROOT / 'scripts/release-bundle.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
cleanup_spec = importlib.util.spec_from_file_location('release_consumer_cleanup', ROOT / 'scripts/release-consumer-cleanup.py')
cleanup = importlib.util.module_from_spec(cleanup_spec)
cleanup_spec.loader.exec_module(cleanup)
rehearsal_spec = importlib.util.spec_from_file_location('deployment_rehearsal', ROOT / 'scripts/deployment-rehearsal.py')
rehearsal = importlib.util.module_from_spec(rehearsal_spec)
rehearsal_spec.loader.exec_module(rehearsal)
SHA = 'a' * 40


def archive(files):
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / 'archive.tar'
        m.pack(path, files, 1)
        return path.read_bytes()


def fixture():
    blobs = {}
    def blob(value):
        data = json.dumps(value).encode()
        key = m.digest(data)
        blobs['blobs/sha256/' + key] = data
        return {'digest': 'sha256:' + key, 'size': len(data)}
    layer_data = archive({'etc/os-release': b'NAME=Alpine\nID=alpine\nVERSION_ID=3.24.3\n', 'lib/apk/db/installed': b'P:musl\nV:1.2.5-r10\nA:x86_64\nL:MIT\nT:musl C library\n\n'})
    layer_hash = m.digest(layer_data)
    blobs['blobs/sha256/' + layer_hash] = layer_data
    layer = {'mediaType': 'application/vnd.oci.image.layer.v1.tar', 'digest': 'sha256:' + layer_hash, 'size': len(layer_data)}
    config = blob({'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + layer_hash]}, 'architecture': 'amd64', 'os': 'linux', 'config': {'Labels': {'org.opencontainers.image.revision': SHA, 'org.operatoros.source.dirty': 'false', 'org.operatoros.source.tree-sha256': 'b' * 64}}})
    config['mediaType'] = 'application/vnd.oci.image.config.v1+json'
    manifest = blob({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json', 'config': config, 'layers': [layer]})
    manifest['mediaType'] = 'application/vnd.oci.image.manifest.v1+json'
    blobs['oci-layout'] = b'{"imageLayoutVersion":"1.0.0"}'
    blobs['index.json'] = json.dumps({'schemaVersion': 2, 'manifests': [manifest]}).encode()
    files = {'operatoros-api.oci.tar': archive(blobs), 'operatoros-web-client.tar.gz': archive({'client/_shell.html': b'shell', 'client/assets/app.js': b'app', 'client/release.json': json.dumps({'source_commit': SHA}).encode()}), 'sbom.cdx.json': b'{"bomFormat":"CycloneDX"}', 'scan.json': b'{"Results":[]}'}
    manifest = {'schema_version': 1, 'lockfiles': {'bun.lock': 'a' * 64, 'mise.lock': 'b' * 64}, 'source_commit': SHA, 'repository': m.REPO, 'workflow': m.WORKFLOW, 'source_ref': 'refs/heads/main', 'run_id': '123', 'run_attempt': '1', 'image': m.image_metadata(files['operatoros-api.oci.tar'], SHA), 'artifacts': {name: m.digest(data) for name, data in files.items()}}
    files['manifest.json'] = json.dumps(manifest).encode()
    checksums(files)
    return files


def checksums(files):
    files['SHA256SUMS'] = ''.join(f'{m.digest(files[name])}  {name}\n' for name in sorted(set(files) - {'SHA256SUMS'})).encode()


class BundleTests(unittest.TestCase):
    def test_consistent_bundle(self):
        self.assertEqual(m.validate(fixture(), SHA)['source_commit'], SHA)

    def test_corruption_and_missing_artifacts(self):
        for name in m.FILES:
            with self.subTest(name=name):
                files = fixture(); files[name] += b'corruption'
                with self.assertRaises((ValueError, json.JSONDecodeError)): m.validate(files, SHA)
                files = fixture(); del files[name]
                with self.assertRaises(ValueError): m.validate(files, SHA)

    def test_mismatched_source(self):
        with self.assertRaises(ValueError): m.validate(fixture(), 'c' * 40)
        files = fixture()
        value = json.loads(files['manifest.json']); value['image']['image_id'] = 'sha256:' + 'd' * 64
        files['manifest.json'] = json.dumps(value).encode(); checksums(files)
        with self.assertRaises(ValueError): m.validate(files, SHA)

    def test_spa_identity_even_with_updated_checksums(self):
        files = fixture()
        files['operatoros-web-client.tar.gz'] = archive({'client/_shell.html': b'shell', 'client/assets/app.js': b'app', 'client/release.json': b'{}'})
        manifest = json.loads(files['manifest.json']); manifest['artifacts']['operatoros-web-client.tar.gz'] = m.digest(files['operatoros-web-client.tar.gz'])
        files['manifest.json'] = json.dumps(manifest).encode(); checksums(files)
        with self.assertRaises(ValueError): m.validate(files, SHA)

    def test_api_metadata_rejects_wrong_commit_and_corrupted_blobs(self):
        files = fixture()
        with self.assertRaises(ValueError): m.image_metadata(files['operatoros-api.oci.tar'], 'f' * 40)
        with tarfile.open(fileobj=io.BytesIO(files['operatoros-api.oci.tar'])) as tar:
            blobs = m.members(tar)
        key = next(name for name in blobs if name.startswith('blobs/'))
        blobs[key] += b'corrupt'
        with self.assertRaises(ValueError): m.image_metadata(archive(blobs), SHA)

    def test_archive_traversal_and_links_rejected(self):
        with tarfile.open(fileobj=io.BytesIO(archive({'../escape': b'bad'}))) as tar:
            with self.assertRaises(ValueError): m.members(tar)
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w') as tar:
            entry = tarfile.TarInfo('link'); entry.type = tarfile.SYMTYPE; entry.linkname = '/etc/passwd'; tar.addfile(entry)
        stream.seek(0)
        with tarfile.open(fileobj=stream) as tar:
            with self.assertRaises(ValueError): m.members(tar)

    def test_provenance_failure_precedes_archive_read(self):
        with patch('sys.argv', ['release-bundle.py', 'verify', '/does-not-exist', SHA]), patch.object(m, 'run', side_effect=ValueError('untrusted provenance')) as command:
            with self.assertRaisesRegex(ValueError, 'untrusted provenance'): m.main()
            args = command.call_args.args
            for flag in ['--source-digest', '--signer-workflow', '--source-ref', '--deny-self-hosted-runners']: self.assertIn(flag, args)
            self.assertIn(SHA, args)

    def test_non_release_contexts_rejected_before_build(self):
        for event, ref in [('pull_request', 'refs/heads/main'), ('schedule', 'refs/heads/main'), ('push', 'refs/heads/main'), ('workflow_dispatch', 'refs/heads/feature')]:
            with self.subTest(event=event, ref=ref), patch.dict('os.environ', {'GITHUB_EVENT_NAME': event, 'GITHUB_REF': ref}), patch.object(m, 'run', return_value=SHA) as command:
                with self.assertRaisesRegex(ValueError, 'trusted manual main'): m.build('/unused', 'podman')
                self.assertEqual(command.call_count, 1)

    def test_layout_scan_uses_archive_identity_and_read_only_mount(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / 'api.tar'; source.write_bytes(fixture()['operatoros-api.oci.tar'])
            expected = m.image_metadata(source.read_bytes(), SHA)
            def scanner(command, log, **kwargs):
                reports = root / 'reports'
                if '/reports/scan.json' in command:
                    (reports / 'scan.json').write_text(json.dumps({'Results': [], 'Metadata': {'ImageID': expected['image_id']}}))
                if '/reports/sbom.cdx.json' in command:
                    (reports / 'sbom.cdx.json').write_text(json.dumps({'bomFormat': 'CycloneDX', 'components': [], 'metadata': {'component': {'properties': [{'name': 'aquasecurity:trivy:ImageID', 'value': expected['image_id']}]}}}))
            with patch.object(m, 'logged', side_effect=scanner) as commands:
                self.assertEqual(m.scan_image(source, SHA, root / 'layout', root / 'reports', 'podman'), expected)
                scan = commands.call_args_list[-1].args[0]
                self.assertIn(str(root / 'layout') + ':/image:ro', scan)
                self.assertIn('/image', scan)
                self.assertNotIn('/out/operatoros-api.oci.tar', scan)

    def test_bad_archive_rejected_before_scanner_with_diagnostics(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / 'bad.tar'; source.write_bytes(b'invalid archive')
            with patch.object(m, 'logged') as scanner:
                with self.assertRaises(tarfile.TarError): m.scan_image(source, SHA, root / 'layout', root / 'reports', 'podman')
                scanner.assert_not_called()
            self.assertTrue((root / 'reports' / 'archive.json').exists())
            self.assertTrue((root / 'reports' / 'scan-error.txt').read_text())

    def test_scanner_exit_is_fatal_and_retains_log(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / 'api.tar'; source.write_bytes(fixture()['operatoros-api.oci.tar'])
            with self.assertRaises(subprocess.CalledProcessError): m.scan_image(source, SHA, root / 'layout', root / 'reports', '/bin/false')
            self.assertTrue((root / 'reports' / 'trivy-version.txt').exists())
            self.assertTrue((root / 'reports' / 'scan-error.txt').read_text())

    def test_missing_malformed_or_wrong_image_reports_are_fatal(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            expected = {'image_id': 'sha256:' + 'a' * 64}
            with self.assertRaises(FileNotFoundError): m.security_reports(root, expected)
            (root / 'scan.json').write_text('not JSON')
            with self.assertRaises(ValueError): m.security_reports(root, expected)
            (root / 'scan.json').write_text(json.dumps({'Results': [], 'Metadata': {'ImageID': 'wrong image'}}))
            (root / 'sbom.cdx.json').write_text('{}')
            with self.assertRaises(ValueError): m.security_reports(root, expected)
            (root / 'scan.json').write_text(json.dumps({'Results': [], 'Metadata': {'ImageID': expected['image_id']}}))
            with self.assertRaises(ValueError): m.security_reports(root, expected)

    def test_failure_upload_contains_only_diagnostics_not_failed_bundles(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        job = workflow.split('  release-bundle:\n')[1].split('\n  changes:')[0]
        diagnostics = job.split('      - name: Retain build and scan failure diagnostics')[1]
        self.assertIn('if: failure()', diagnostics)
        self.assertIn('release-diagnostics/*.json', diagnostics)
        self.assertIn('release-diagnostics/*.log', diagnostics)
        self.assertIn('release-diagnostics/*.txt', diagnostics)
        self.assertNotIn('operatoros-release.tar', diagnostics)
        self.assertNotIn('continue-on-error', job)
        self.assertIn('python3 scripts/tests/check_trivy_oci.py', workflow)

    def test_workflow_requires_success_and_exact_checkout(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        job = workflow.split('  release-bundle:\n')[1].split('\n  changes:')[0]
        self.assertIn("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'", job)
        self.assertIn('needs: [release, result]', job)
        self.assertNotIn('always()', job)
        self.assertIn('ref: ${{ github.sha }}', job)
        self.assertIn('cancel-in-progress: false', job)
        self.assertLess(job.index('Attest the complete release bundle'), job.index('Retain immutable release bundle'))
        release = workflow.split('  release:\n')[1].split('  release-bundle:')[0]
        self.assertIn('ref: ${{ github.sha }}', release)
        self.assertIn('run: mise run check:full', release)
        api = workflow.split('  api:\n')[1].split('\n  frontend:')[0]
        self.assertIn('OPERATOROS_TEST_ROOTLESS_PODMAN: "1"', api)

    def test_deployment_rehearsal_is_manual_confirmed_read_only_and_separate(self):
        workflow = (ROOT / '.github/workflows/deployment-rehearsal.yml').read_text()
        triggers = workflow.split('permissions:', 1)[0]
        self.assertIn('workflow_dispatch:', triggers)
        self.assertNotIn('pull_request:', triggers)
        self.assertNotIn('push:', triggers)
        self.assertNotIn('schedule:', triggers)
        self.assertIn('type: boolean', triggers)
        self.assertIn('default: false', triggers)
        self.assertIn("inputs.confirm_rehearsal == true", workflow)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)
        self.assertIn('runs-on: ubuntu-24.04', workflow)
        self.assertIn('contents: none', workflow)
        job = workflow.split('  rehearsal:\n', 1)[1]
        permissions = job.split('permissions:', 1)[1].split('steps:', 1)[0]
        self.assertIn('actions: read', permissions)
        self.assertIn('attestations: read', permissions)
        self.assertIn('contents: read', permissions)
        self.assertNotIn('id-token:', permissions)
        self.assertNotIn('write', permissions)
        self.assertIn('persist-credentials: false', job)
        self.assertIn('cache-write: "false"', job)
        self.assertIn('OPERATOROS_RELEASE_TOKEN: ${{ github.token }}', job)
        self.assertIn('python3 scripts/deployment-rehearsal.py', job)
        self.assertNotIn('ci.yml', job)
        self.assertNotIn('deploy.sh', job)
        self.assertIn('retention-days: 14', job)
        self.assertNotIn('operatoros.sqlite', job)
        self.assertNotIn('api.env', job)
        self.assertNotIn('graphroot', job)

    def test_deployment_rehearsal_pins_existing_artifact_and_never_builds_or_deploys_live(self):
        script = (ROOT / 'scripts/deployment-rehearsal.py').read_text()
        for identity in (
            '278faae7a027cf1c96326d32a9b796618d75620e',
            '41987515713',
            '13396749662',
            'a8a1555d2184ca1daeeb2d4d4d48dceffd08961215c125721d8ed7b108a18435',
            '22829ed9a872500fae1d793fda85059384321ccf827fcd770cc2401ae6458cf7',
        ):
            self.assertIn(identity, script)
        self.assertIn('deploy.verified_artifact(request', script)
        self.assertIn('verified.bundle_sha256 == INNER_BUNDLE_SHA256', script)
        self.assertIn('OPERATOROS_REHEARSAL_CONFIRMED', script)
        self.assertIn('RUNNER_TEMP', script)
        self.assertIn('podman-rootless/graphroot', script)
        self.assertIn('show-environment', script)
        self.assertIn('OPERATOROS_RELEASE_TOKEN', script)
        self.assertIn('REGISTRY_AUTH_FILE', script)
        self.assertNotIn('podman", "build', script)
        self.assertNotIn('sudo ', script)
        self.assertNotIn('/mnt/podman-data/operatoros', script)


class ReleaseConsumerCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='operatoros-release-cleanup-tests-')
        self.temp_parent = Path(self.temp.name).resolve()
        self.workspace = self.temp_parent / 'operatoros-release-consumer.fixture01'
        self.workspace.mkdir(mode=0o700)
        self.graphroot = self.workspace / 'graphroot'
        self.runroot = self.workspace / 'runroot'
        self.graphroot.mkdir()
        self.runroot.mkdir()
        self.storage_conf = self.workspace / 'storage.conf'
        self.storage_conf.write_text(
            '[storage]\n'
            'driver="vfs"\n'
            f'graphroot="{self.graphroot}"\n'
            f'runroot="{self.runroot}"\n',
            encoding='utf-8',
        )
        self.storage_conf.chmod(0o600)
        self.external = self.temp_parent / 'unrelated.txt'
        self.external.write_text('preserve', encoding='utf-8')
        self.environment = {
            'CONTAINERS_STORAGE_CONF': str(self.storage_conf),
            'HOME': str(self.temp_parent),
            'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
            'TMPDIR': str(self.temp_parent),
            'XDG_RUNTIME_DIR': str(self.temp_parent),
        }
        self.commands = []
        self.rm_status = 0
        self.mount_status = 0
        self.containers_output = ''
        self.mounts_output = ''

    def tearDown(self):
        self.temp.cleanup()

    def fake_podman(self, arguments, workspace, log_path):
        self.commands.append(arguments)
        if arguments[0] == 'rm':
            return subprocess.CompletedProcess(arguments, self.rm_status, '', 'simulated rm result')
        if arguments[:3] == ['ps', '--all', '--quiet']:
            return subprocess.CompletedProcess(arguments, 0, self.containers_output, '')
        if arguments == ['unshare', 'podman', 'mount']:
            return subprocess.CompletedProcess(arguments, self.mount_status, self.mounts_output, '')
        if arguments[0] == 'unshare':
            cleanup.remove_store_in_user_namespace(workspace, self.temp_parent)
            # Podman may recreate runner-owned lock directories while its namespace exits.
            _prefix, profile = cleanup.workspace_profile(workspace)
            for key in ('graphroot', 'runroot'):
                residual = workspace / profile[key] / 'podman-locks'
                residual.mkdir(parents=True)
                (residual / 'lock').write_text('synthetic lock', encoding='utf-8')
            return subprocess.CompletedProcess(arguments, 0, '', '')
        self.fail(f'unexpected Podman command: {arguments}')

    def run_cleanup(self, workspace=None):
        with unittest.mock.patch.dict(os.environ, self.environment, clear=True), \
             unittest.mock.patch.object(cleanup, 'run_podman', side_effect=self.fake_podman):
            return cleanup.cleanup(str(workspace or self.workspace), str(self.temp_parent))

    def test_consumer_success_removes_only_its_store_and_preserves_unrelated_process(self):
        layer = self.graphroot / 'vfs' / 'dir' / 'layer'
        layer.mkdir(parents=True)
        (layer / 'payload').write_text('synthetic image layer', encoding='utf-8')
        process = subprocess.Popen(['sleep', '30'])
        try:
            self.assertEqual(self.run_cleanup(), 0)
            self.assertFalse(self.workspace.exists())
            self.assertEqual(self.external.read_text(encoding='utf-8'), 'preserve')
            self.assertIsNone(process.poll())
            self.assertEqual(self.commands[0], ['rm', '--force', '--ignore', 'operatoros-release-api', 'operatoros-release-web'])
            self.assertNotIn('--all', self.commands[0])
            self.assertIn(['unshare', 'podman', 'mount'], self.commands)
            self.assertEqual(self.commands[-1][0], 'unshare')
        finally:
            process.terminate()
            process.wait(timeout=5)

    def test_deployment_rehearsal_profile_cleans_only_its_scoped_containers(self):
        workspace = self.temp_parent / 'operatoros-deployment-rehearsal.123456789a1'
        workspace.mkdir(mode=0o700)
        graphroot = workspace / 'podman-rootless/graphroot'
        runroot = workspace / 'podman-rootless/runroot'
        graphroot.mkdir(parents=True)
        runroot.mkdir()
        storage_conf = workspace / 'deploy/storage.conf'
        storage_conf.parent.mkdir()
        storage_conf.write_text(
            '[storage]\n'
            'driver="vfs"\n'
            f'graphroot="{graphroot}"\n'
            f'runroot="{runroot}"\n',
            encoding='utf-8',
        )
        storage_conf.chmod(0o600)
        environment = self.environment | {'CONTAINERS_STORAGE_CONF': str(storage_conf)}
        with unittest.mock.patch.dict(os.environ, environment, clear=True), \
             unittest.mock.patch.object(cleanup, 'run_podman', side_effect=self.fake_podman):
            self.assertEqual(cleanup.cleanup(str(workspace), str(self.temp_parent)), 0)
        self.assertFalse(workspace.exists())
        self.assertEqual(self.external.read_text(encoding='utf-8'), 'preserve')
        self.assertEqual(self.commands[0], [
            'rm', '--force', '--ignore', 'operatoros-lite-api', 'operatoros-lite-caddy',
        ])

    def test_deployment_rehearsal_rejects_unsafe_store_with_cleanup_error(self):
        workspace = self.temp_parent / 'operatoros-deployment-rehearsal.123456789a1'
        workspace.mkdir(mode=0o700)
        storage = workspace / 'deploy/storage.conf'
        storage.parent.mkdir()
        external_store = self.temp_parent / 'external-store'
        external_store.mkdir()
        (workspace / 'podman-rootless').mkdir()
        (workspace / 'podman-rootless/graphroot').symlink_to(external_store, target_is_directory=True)
        (workspace / 'podman-rootless/runroot').mkdir()
        storage.write_text(
            '[storage]\n'
            'driver="vfs"\n'
            f'graphroot="{workspace / "podman-rootless/graphroot"}"\n'
            f'runroot="{workspace / "podman-rootless/runroot"}"\n',
            encoding='utf-8',
        )
        storage.chmod(0o600)
        environment = self.environment | {'CONTAINERS_STORAGE_CONF': str(storage)}
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(cleanup.CleanupError, 'unsafe consumer graphroot path'):
                cleanup.validate_workspace(str(workspace), str(self.temp_parent))
        with patch.object(cleanup, 'validate_workspace', return_value=(workspace, self.temp_parent, storage)):
            with self.assertRaisesRegex(cleanup.CleanupError, 'graphroot'):
                cleanup.remove_store_in_user_namespace(workspace, self.temp_parent)
        self.assertTrue(external_store.is_dir())


    def test_cleanup_command_failure_is_reported_even_if_store_is_removed(self):
        self.rm_status = 9
        with unittest.mock.patch('sys.stderr', new_callable=io.StringIO) as error:
            self.assertEqual(self.run_cleanup(), 1)
            self.assertIn('exit=9', error.getvalue())
        self.assertFalse(self.workspace.exists())

    def test_remaining_container_or_mount_blocks_filesystem_cleanup(self):
        self.containers_output = 'unexpected-container\n'
        self.assertEqual(self.run_cleanup(), 1)
        self.assertTrue(self.workspace.exists())
        self.assertIn(['unshare', 'podman', 'mount'], self.commands)
        self.assertFalse(any(command[:2] == ['unshare', sys.executable] for command in self.commands))

        self.commands.clear()
        self.containers_output = ''
        self.mounts_output = '/tmp/consumer-mount\n'
        self.assertEqual(self.run_cleanup(), 1)
        self.assertTrue(self.workspace.exists())
        self.assertIn(['unshare', 'podman', 'mount'], self.commands)
        self.assertFalse(any(command[:2] == ['unshare', sys.executable] for command in self.commands))

        self.commands.clear()
        self.mounts_output = ''
        self.mount_status = 125
        self.assertEqual(self.run_cleanup(), 1)
        self.assertTrue(self.workspace.exists())
        self.assertIn(['unshare', 'podman', 'mount'], self.commands)
        self.assertFalse(any(command[:2] == ['unshare', sys.executable] for command in self.commands))

    def test_traversal_symlink_and_shared_storage_paths_are_rejected(self):
        shared = self.temp_parent / 'shared-storage'
        shared.mkdir()
        marker = shared / 'keep.txt'
        marker.write_text('preserve', encoding='utf-8')
        with unittest.mock.patch.dict(os.environ, self.environment, clear=True), \
             unittest.mock.patch.object(cleanup, 'run_podman') as run:
            traversal = str(self.workspace / '..' / 'shared-storage')
            self.assertEqual(cleanup.cleanup(traversal, str(self.temp_parent)), 1)
            self.assertEqual(cleanup.cleanup('', str(self.temp_parent)), 1)
            self.assertEqual(cleanup.cleanup('/', str(self.temp_parent)), 1)
            link = self.temp_parent / 'operatoros-release-consumer.symlink01'
            link.symlink_to(self.workspace, target_is_directory=True)
            self.assertEqual(cleanup.cleanup(str(link), str(self.temp_parent)), 1)
            self.assertEqual(cleanup.cleanup(str(shared), str(self.temp_parent)), 1)
            run.assert_not_called()
        self.assertEqual(marker.read_text(encoding='utf-8'), 'preserve')
        self.assertTrue(self.workspace.exists())

        data_root = self.temp_parent / 'synthetic-application-data'
        data_temp = data_root / 'tmp'
        data_workspace = data_temp / 'operatoros-release-consumer.fixture02'
        data_workspace.mkdir(parents=True, mode=0o700)
        (data_workspace / 'graphroot').mkdir()
        (data_workspace / 'runroot').mkdir()
        data_config = data_workspace / 'storage.conf'
        data_config.write_text(
            '[storage]\n'
            'driver="vfs"\n'
            f'graphroot="{data_workspace / "graphroot"}"\n'
            f'runroot="{data_workspace / "runroot"}"\n',
            encoding='utf-8',
        )
        with unittest.mock.patch.dict(os.environ, self.environment | {
            'CONTAINERS_STORAGE_CONF': str(data_config),
            'OPERATOROS_DATA_DIR': str(data_root),
        }, clear=True), unittest.mock.patch.object(cleanup, 'run_podman') as run:
            self.assertEqual(cleanup.cleanup(str(data_workspace), str(data_temp)), 1)
            run.assert_not_called()

        with unittest.mock.patch.dict(os.environ, self.environment | {
            'OPERATOROS_DATA_DIR': str(self.workspace / 'state'),
        }, clear=True), unittest.mock.patch.object(cleanup, 'run_podman') as run:
            self.assertEqual(cleanup.cleanup(str(self.workspace), str(self.temp_parent)), 1)
            run.assert_not_called()

        with unittest.mock.patch.dict(os.environ, self.environment | {
            'XDG_DATA_HOME': str(self.workspace),
        }, clear=True), unittest.mock.patch.object(cleanup, 'run_podman') as run:
            self.assertEqual(cleanup.cleanup(str(self.workspace), str(self.temp_parent)), 1)
            run.assert_not_called()

    def test_shared_graphroot_or_symlinked_graphroot_is_rejected(self):
        shared = self.temp_parent / 'shared-storage'
        shared.mkdir()
        marker = shared / 'keep.txt'
        marker.write_text('preserve', encoding='utf-8')
        self.storage_conf.write_text(
            '[storage]\n'
            'driver="vfs"\n'
            f'graphroot="{shared}"\n'
            f'runroot="{self.runroot}"\n',
            encoding='utf-8',
        )
        with unittest.mock.patch.dict(os.environ, self.environment, clear=True), \
             unittest.mock.patch.object(cleanup, 'run_podman') as run:
            self.assertEqual(cleanup.cleanup(str(self.workspace), str(self.temp_parent)), 1)
            run.assert_not_called()
        self.assertEqual(marker.read_text(encoding='utf-8'), 'preserve')

        self.storage_conf.write_text(
            '[storage]\n'
            'driver="vfs"\n'
            f'graphroot="{self.graphroot}"\n'
            f'runroot="{self.runroot}"\n',
            encoding='utf-8',
        )
        self.graphroot.rmdir()
        self.graphroot.symlink_to(shared, target_is_directory=True)
        with unittest.mock.patch.dict(os.environ, self.environment, clear=True), \
             unittest.mock.patch.object(cleanup, 'run_podman') as run:
            self.assertEqual(cleanup.cleanup(str(self.workspace), str(self.temp_parent)), 1)
            run.assert_not_called()
        self.assertEqual(marker.read_text(encoding='utf-8'), 'preserve')

    def test_host_cleanup_rejects_store_residuals_not_owned_by_runner(self):
        marker = self.graphroot / 'storage.lock'
        marker.write_text('synthetic lock', encoding='utf-8')
        runner_uid = os.geteuid()
        with unittest.mock.patch.object(cleanup.os, 'geteuid', return_value=runner_uid + 1):
            with self.assertRaises(cleanup.CleanupError):
                cleanup.remove_host_owned_store_residual(self.graphroot, self.workspace)
        self.assertTrue(marker.exists())

    def test_cleanup_command_environment_excludes_credentials_and_remote_storage(self):
        with unittest.mock.patch.dict(os.environ, self.environment | {
            'GH_TOKEN': 'must-not-propagate',
            'CONTAINER_HOST': 'tcp://unexpected.example',
        }, clear=True):
            env = cleanup.command_environment()
        self.assertEqual(env['CONTAINERS_STORAGE_CONF'], str(self.storage_conf))
        self.assertNotIn('GH_TOKEN', env)
        self.assertNotIn('CONTAINER_HOST', env)

    def test_existing_allowlisted_diagnostics_directory_can_receive_cleanup_log(self):
        diagnostics = self.temp_parent / 'release-diagnostics'
        diagnostics.mkdir(mode=0o755)
        log = diagnostics / 'consumer-cleanup.log'
        log.write_text('build diagnostics\n', encoding='utf-8')
        log.chmod(0o644)
        with unittest.mock.patch.dict(os.environ, self.environment, clear=True):
            path = cleanup.diagnostic_log(str(diagnostics), self.temp_parent, self.workspace)
            cleanup.append_log(path, 'consumer cleanup exit=0')
        self.assertEqual(log.read_text(encoding='utf-8'), 'build diagnostics\nconsumer cleanup exit=0\n')

    def run_exit_trap(self, consumer_status, rm_status):
        fake_bin = self.temp_parent / 'bin'
        fake_bin.mkdir()
        calls = self.temp_parent / 'podman-calls.log'
        fake_podman = fake_bin / 'podman'
        fake_podman.write_text(
            '#!/bin/sh\n'
            f'printf "%s\\n" "$*" >> {str(calls)!r}\n'
            'case "$1" in\n'
            f'  rm) exit {rm_status} ;;\n'
            '  ps|mount) exit 0 ;;\n'
            '  unshare) shift; exec "$@" ;;\n'
            '  *) exit 64 ;;\n'
            'esac\n',
            encoding='utf-8',
        )
        fake_podman.chmod(0o700)
        self.storage_conf.chmod(0o600)
        library = ROOT / 'scripts/release-consumer-cleanup-trap.sh'
        bash_script = (
            'set -euo pipefail\n'
            f'workspace={str(self.workspace)!r}\n'
            f'temp_parent={str(self.temp_parent)!r}\n'
            f'source {str(library)!r}\n'
            'trap "operatoros_release_consumer_exit \\\"$workspace\\\" \\\"$temp_parent\\\"" EXIT\n'
            f'exit {consumer_status}\n'
        )
        env = self.environment | {
            'PATH': f'{fake_bin}:/usr/bin:/bin',
            'RUNNER_TEMP': str(self.temp_parent),
            'PYTHONDONTWRITEBYTECODE': '1',
        }
        result = subprocess.run(['bash', '-c', bash_script], env=env, capture_output=True, text=True)
        return result, calls.read_text(encoding='utf-8')

    def test_startup_failure_triggers_successful_cleanup_and_preserves_exit_code(self):
        result, calls = self.run_exit_trap(23, 0)
        self.assertEqual(result.returncode, 23)
        self.assertIn('[consumer] failed with exit code 23', result.stderr)
        self.assertNotIn('[cleanup] failed', result.stderr)
        self.assertIn('rm --force --ignore operatoros-release-api operatoros-release-web', calls)
        self.assertFalse(self.workspace.exists())

    def test_successful_consumer_fails_when_cleanup_fails(self):
        result, calls = self.run_exit_trap(0, 9)
        self.assertEqual(result.returncode, 1)
        self.assertIn('Podman consumer container removal failed with exit=9', result.stderr)
        self.assertIn('Consumer cleanup did not complete successfully', result.stderr)
        self.assertIn('unshare', calls)
        self.assertFalse(self.workspace.exists())

    def test_consumer_and_cleanup_failures_are_both_reported_without_masking_consumer(self):
        result, calls = self.run_exit_trap(23, 9)
        self.assertEqual(result.returncode, 23)
        self.assertIn('[consumer] failed with exit code 23', result.stderr)
        self.assertIn('[cleanup] failed with exit code 1', result.stderr)
        self.assertIn('Podman consumer container removal failed with exit=9', result.stderr)
        self.assertIn('rm --force --ignore operatoros-release-api operatoros-release-web', calls)
        self.assertFalse(self.workspace.exists())

    def test_subordinate_uid_files_are_cleaned_by_podman_unshare(self):
        if os.environ.get('OPERATOROS_TEST_ROOTLESS_PODMAN') != '1':
            self.skipTest('set OPERATOROS_TEST_ROOTLESS_PODMAN=1 on a rootless Podman host')
        if shutil.which('podman') is None:
            self.fail('rootless Podman is required when OPERATOROS_TEST_ROOTLESS_PODMAN=1')
        user = pwd.getpwuid(os.getuid()).pw_name
        subuid_path = Path('/etc/subuid')
        subgid_path = Path('/etc/subgid')
        ranges = {}
        for label, path in (('UID', subuid_path), ('GID', subgid_path)):
            starts = [int(line.split(':')[1]) for line in path.read_text(encoding='utf-8').splitlines()
                      if line.startswith(f'{user}:') and len(line.split(':')) == 3]
            if not starts:
                self.fail(f'a subordinate {label} range is required for the rootless cleanup regression')
            ranges[label] = starts[0]

        layer = self.graphroot / 'vfs' / 'dir' / 'layer'
        env = self.environment | {'CONTAINERS_STORAGE_CONF': str(self.storage_conf)}
        create = subprocess.run(
            ['podman', 'unshare', 'sh', '-c',
             'set -eu; mkdir -p "$1"; printf synthetic > "$1/file"; chown -R 1:1 "$(dirname "$1")"; chmod 755 "$(dirname "$1")"',
             'sh', str(layer)],
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(create.returncode, 0, create.stderr)
        self.assertEqual(layer.stat().st_uid, ranges['UID'])
        self.assertEqual(layer.stat().st_gid, ranges['GID'])
        with self.assertRaises(PermissionError):
            (layer / 'file').unlink()

        with unittest.mock.patch.dict(os.environ, self.environment, clear=False):
            self.assertEqual(cleanup.cleanup(str(self.workspace), str(self.temp_parent)), 0)
        self.assertFalse(self.workspace.exists())
        self.assertEqual(self.external.read_text(encoding='utf-8'), 'preserve')

    def test_consumer_health_and_static_site_assertions_remain_enabled(self):
        harness = (ROOT / 'scripts/test-release-consumer.sh').read_text(encoding='utf-8')
        for required in (
            'curl -fsS "http://127.0.0.1:$web_port/ready"',
            'curl -fsS "http://127.0.0.1:$web_port/health"',
            'attendance/calendar',
            'cmp - "$workspace/client/_shell.html"',
            '.env")" == 404',
            'missing.js")" == 404',
        ):
            self.assertIn(required, harness)


class RehearsalUnitCleanupTests(unittest.TestCase):
    def test_teardown_stops_only_run_scoped_quadlets_created_by_this_run(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-units-') as temp:
            unit_dir = Path(temp)
            services = ('operatoros-rehearsal-123456789-1-api.service',
                        'operatoros-rehearsal-123456789-1-caddy.service')
            api_unit, caddy_unit = tuple(
                unit_dir / (service.removesuffix('.service') + '.container') for service in services
            )
            api_copy = unit_dir / 'operatoros-lite-api.container'
            unrelated = unit_dir / 'unrelated.service'
            for path in (api_unit, caddy_unit, api_copy, unrelated):
                path.write_text('synthetic', encoding='utf-8')

            def systemctl(arguments, **_kwargs):
                return subprocess.CompletedProcess(arguments, 3 if 'is-active' in arguments else 0, '', '')

            with patch.object(rehearsal.subprocess, 'run', side_effect=systemctl) as run:
                rehearsal.remove_run_units(unit_dir, services, {api_unit, caddy_unit, api_copy})

            commands = [call.args[0] for call in run.call_args_list]
            self.assertEqual([command[3] for command in commands if command[2] == 'stop'], list(services))
            self.assertEqual([command[4] for command in commands if command[2] == 'is-active'], list(services))
            self.assertFalse(api_unit.exists())
            self.assertFalse(caddy_unit.exists())
            self.assertTrue(api_copy.is_file())
            self.assertTrue(unrelated.is_file())
