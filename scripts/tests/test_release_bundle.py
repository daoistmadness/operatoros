import importlib.util
import io
import json
import os
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
import pwd
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch

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
deploy_spec = importlib.util.spec_from_file_location('operatoros_deploy_tests', ROOT / 'scripts/operatoros_deploy.py')
deploy = importlib.util.module_from_spec(deploy_spec)
sys.modules[deploy_spec.name] = deploy
deploy_spec.loader.exec_module(deploy)
SHA = 'a' * 40


def private_context(workspace):
    return deploy.create_private_podman_context(workspace)


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


class ReleasePipelineAndDeploymentRehearsalTests(unittest.TestCase):
    def test_rehearsal_workspace_scaffold_leaves_synthetic_data_to_its_initializer(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-scaffold-') as temporary:
            runner_temp = Path(temporary).resolve()
            workspace = runner_temp / 'operatoros-deployment-rehearsal.123456789a1'
            with patch.dict(os.environ, {}, clear=True):
                rehearsal.create_rehearsal_workspace(runner_temp, workspace)
            self.assertTrue((workspace / 'deploy').is_dir())
            self.assertTrue((workspace / 'web/releases').is_dir())
            self.assertFalse((workspace / 'data').exists())

    def test_deployment_failure_record_reports_phase_without_filesystem_paths(self):
        private_path = '/tmp/private-rehearsal/synthetic-data'
        report = {'deployment': rehearsal.initial_deployment_record()}
        report['deployment']['status'] = 'in_progress'
        with patch.object(rehearsal, 'REPORT', report):
            rehearsal.deployment_progress('synthetic_database_setup_started',
                                          completed_guard='verified_oci_import')
            rehearsal.retain_deployment_failure(FileExistsError(17, 'File exists', private_path))
        failure = report['deployment']['failure']
        self.assertEqual(failure['code'], 'DEPLOY_PATH_COLLISION')
        self.assertEqual(failure['phase'], 'synthetic_database_setup_started')
        self.assertEqual(failure['last_completed_guard'], 'verified_oci_import')
        self.assertEqual(failure['exception_class'], 'FileExistsError')
        self.assertEqual(failure['path_category'], 'synthetic_data_directory')
        self.assertEqual(failure['expected'], 'path_absent')
        self.assertEqual(failure['observed'], 'path_exists')
        self.assertNotIn(private_path, json.dumps(report))
        self.assertNotIn('File exists', json.dumps(report))

    def test_deployment_failure_codes_identify_import_quadlet_startup_and_acceptance(self):
        cases = (
            ('oci_import_started', 'DEPLOY_OCI_IMPORT_FAILED', 'release_staged'),
            ('quadlet_staging_started', 'DEPLOY_QUADLET_STAGING_FAILED', 'synthetic_database_ready'),
            ('application_start_started', 'DEPLOY_APPLICATION_START_FAILED', 'quadlet_files_staged'),
            ('application_acceptance_started', 'DEPLOY_APPLICATION_ACCEPTANCE_FAILED', 'deployed_application_healthy'),
        )
        for phase, expected_code, previous_guard in cases:
            with self.subTest(phase=phase):
                report = {'deployment': rehearsal.initial_deployment_record()}
                report['deployment']['status'] = 'in_progress'
                with patch.object(rehearsal, 'REPORT', report):
                    rehearsal.deployment_progress(phase, completed_guard=previous_guard)
                    rehearsal.retain_deployment_failure(rehearsal.RehearsalError('sensitive detail'))
                failure = report['deployment']['failure']
                self.assertEqual(failure['code'], expected_code)
                self.assertEqual(failure['last_completed_guard'], previous_guard)
                self.assertNotIn('sensitive detail', json.dumps(report))

    def test_synthetic_database_setup_fails_closed_on_preexisting_data_directory(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-data-collision-') as temporary:
            workspace = Path(temporary) / 'operatoros-deployment-rehearsal.fixture01'
            workspace.mkdir(mode=0o700)
            data = workspace / 'data'
            data.mkdir(mode=0o700)
            marker = data / 'preserve-me'
            marker.write_text('unrelated synthetic marker', encoding='utf-8')
            report = {}
            environment = {
                'GITHUB_RUN_ID': '123456789',
                'GITHUB_RUN_ATTEMPT': '1',
                'OPERATOROS_REHEARSAL_ORIGIN': 'http://127.0.0.1:18080',
                'PATH': '/usr/bin:/bin',
            }
            with patch.object(rehearsal, 'REPORT', report), \
                 patch.dict(os.environ, environment, clear=True), \
                 patch.object(rehearsal, 'create_podman_secret') as create_secret:
                with self.assertRaises(FileExistsError):
                    rehearsal.setup_synthetic_database(workspace, SHA, None)
            create_secret.assert_not_called()
            self.assertEqual(marker.read_text(encoding='utf-8'), 'unrelated synthetic marker')
            failure = report['synthetic_database_setup']['failure']
            self.assertEqual(failure['code'], 'DB_SETUP_DATA_ROOT_CREATE_FAILED')
            self.assertEqual(failure['classification'], 'unexpected_existing_path')
            self.assertFalse(report['synthetic_database_setup']['database_initializer_started'])

    def test_database_setup_rejects_missing_run_identity_before_creating_data_root(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-invalid-input-') as temporary:
            workspace = Path(temporary) / 'operatoros-deployment-rehearsal.fixture01'
            workspace.mkdir(mode=0o700)
            report = {}
            with patch.object(rehearsal, 'REPORT', report), \
                 patch.dict(os.environ, {
                     'OPERATOROS_REHEARSAL_ORIGIN': 'http://127.0.0.1:18080',
                 }, clear=True), \
                 patch.object(rehearsal, 'create_podman_secret') as create_secret:
                with self.assertRaises(rehearsal.RehearsalError):
                    rehearsal.setup_synthetic_database(workspace, SHA, None)

            create_secret.assert_not_called()
            self.assertFalse((workspace / 'data').exists())
            setup = report['synthetic_database_setup']
            self.assertEqual(setup['failure']['code'], 'DB_SETUP_INPUTS_VALIDATION_FAILED')
            self.assertEqual(setup['failure']['classification'], 'validation_rejected')
            self.assertEqual(setup['last_completed_operation'], 'none')

    def test_database_setup_bootstrap_failure_identifies_operation_without_raw_output(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-bootstrap-failure-') as temporary:
            root = Path(temporary)
            workspace = root / 'operatoros-deployment-rehearsal.fixture01'
            workspace.mkdir(mode=0o700)
            (workspace / 'deploy').mkdir(mode=0o700)
            context = private_context(workspace)
            diagnostics = root / 'diagnostics'
            diagnostics.mkdir(mode=0o700)
            report = {'deployment': rehearsal.initial_deployment_record()}
            report['deployment'].update({
                'status': 'in_progress',
                'phase': 'synthetic_database_setup_started',
                'last_completed_guard': 'runtime_image_pulled',
            })
            calls = []
            private_output = 'DATA_DIR_NOT_EMPTY /private/runner/path'

            def fail_bootstrap(args, **kwargs):
                calls.append((args, kwargs))
                if args[:3] == ['bun', 'packages/db/src/db-cli.ts', 'bootstrap']:
                    return subprocess.CompletedProcess(args, 1, '', private_output)
                return subprocess.CompletedProcess(args, 0, '', '')

            environment = {
                'GITHUB_RUN_ID': '123456789',
                'GITHUB_RUN_ATTEMPT': '1',
                'OPERATOROS_REHEARSAL_ORIGIN': 'http://127.0.0.1:18080',
                'PATH': '/usr/bin:/bin',
            }
            with patch.object(rehearsal, 'REPORT', report), \
                 patch.object(rehearsal, 'DIAGNOSTICS', diagnostics), \
                 patch.dict(os.environ, environment, clear=True), \
                 patch.object(rehearsal.subprocess, 'run', side_effect=fail_bootstrap):
                with self.assertRaises(rehearsal.RehearsalError) as raised:
                    rehearsal.setup_synthetic_database(workspace, SHA, context)
                rehearsal.retain_deployment_failure(raised.exception)

            setup = report['synthetic_database_setup']
            self.assertEqual(len(calls), 3)
            self.assertEqual(setup['current_operation'], 'DB_SETUP_DATABASE_BOOTSTRAP')
            self.assertEqual(setup['last_completed_operation'], 'DB_SETUP_API_ENV_STAGE')
            self.assertTrue(setup['database_initializer_started'])
            self.assertFalse(setup['database_initializer_completed'])
            self.assertFalse(setup['schema_verification_completed'])
            self.assertEqual(setup['failure'], {
                'code': 'DB_SETUP_DATABASE_BOOTSTRAP_FAILED',
                'operation_id': 'DB_SETUP_DATABASE_BOOTSTRAP',
                'exception_class': 'SubprocessExit',
                'exit_code': 1,
                'classification': 'unexpected_nonempty_data_root',
            })
            deployment_failure = report['deployment']['failure']
            self.assertEqual(deployment_failure['code'], 'DEPLOY_SYNTHETIC_DATABASE_SETUP_FAILED')
            self.assertEqual(deployment_failure['operation_failure_code'], 'DB_SETUP_DATABASE_BOOTSTRAP_FAILED')
            self.assertEqual(deployment_failure['last_completed_operation'], 'DB_SETUP_API_ENV_STAGE')
            rendered = json.dumps(report)
            self.assertNotIn(private_output, rendered)
            self.assertNotIn('/private/runner/path', rendered)
            log_text = (diagnostics / 'rehearsal.log').read_text(encoding='utf-8')
            self.assertIn('operation=DB_SETUP_DATABASE_BOOTSTRAP status=failed exit=1', log_text)
            self.assertIn('classification=unexpected_nonempty_data_root', log_text)
            self.assertNotIn(private_output, log_text)
            self.assertNotIn('/private/runner/path', log_text)

    def test_subprocess_failure_classification_is_allowlisted_and_distinguishes_causes(self):
        cases = (
            (['bun'], '', 'FileNotFoundError', 'command_not_found'),
            (['bun'], 'Permission denied', None, 'permission_rejected'),
            (['podman', 'secret', 'create'], 'unexpected failure', None, 'container_command_failed'),
            (['bun'], 'DATA_DIR_NOT_EMPTY', None, 'unexpected_nonempty_data_root'),
            (['bun'], 'DATABASE_ALREADY_EXISTS', None, 'database_already_exists'),
            (['bun'], 'BOOTSTRAP_SCHEMA_MISMATCH', None, 'schema_mismatch'),
            (['bun'], 'SQLiteError: database is locked', None, 'sqlite_initialization_failure'),
            (['bun'], 'Cannot find module', None, 'working_directory_or_script_unavailable'),
            (['bun'], 'No such file or directory', None, 'missing_expected_file'),
            (['bun'], 'unclassified child output', None, 'nonzero_exit'),
        )
        for args, output, exception_class, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(
                    rehearsal.classify_subprocess_failure(args, output, exception_class), expected,
                )

    def test_cleanup_environment_keeps_private_image_temp_directory(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-cleanup-env-') as temporary:
            workspace = Path(temporary) / 'operatoros-deployment-rehearsal.123456789a1'
            workspace.mkdir(mode=0o700)
            context = private_context(workspace)
            with patch.dict(os.environ, {'XDG_DATA_HOME': str(Path(temporary) / 'host-xdg')}, clear=True):
                environment = rehearsal.cleanup_environment(workspace, context)
            self.assertEqual(environment['TMPDIR'], str(workspace / 'podman-rootless/image-tmp'))
            self.assertEqual(environment['XDG_CONFIG_HOME'], str(context.xdg_config_home))
            self.assertIn('OPERATOROS_REHEARSAL_HOST_XDG_DATA_HOME', environment)

    def test_verified_cleanup_passes_private_tmpdir_and_embeds_child_result(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-cleanup-parent-') as temporary:
            runner_temp = Path(temporary).resolve()
            workspace = runner_temp / 'operatoros-deployment-rehearsal.123456789a1'
            diagnostics = runner_temp / 'operatoros-deployment-rehearsal-diagnostics.123456789a1'
            workspace.mkdir(mode=0o700)
            diagnostics.mkdir(mode=0o700)
            context = private_context(workspace)
            removed = {
                'attempted': True,
                'phase': 'complete',
                'failure_code': None,
                'exit_code': 0,
                'command_exit_code': None,
                'ownership_validated': True,
                'resources_removed': ['run_scoped_containers', 'private_store_contents', 'workspace'],
                'resources_remaining': [],
                'diagnostics_log_created': True,
                'status': 'passed',
            }
            observed = {}

            def successful_cleanup(_args, **kwargs):
                observed.update(kwargs['env'])
                shutil.rmtree(workspace)
                return subprocess.CompletedProcess(
                    _args, 0, 'OPERATOROS_CLEANUP_RESULT=' + json.dumps(removed), '',
                )

            report = {}
            with patch.object(rehearsal, 'REPORT', report), \
                 patch.object(rehearsal, 'PODMAN_CONTEXT_VERIFIED', True), \
                 patch.dict(os.environ, context.environment() | {'PATH': '/usr/bin:/bin'}, clear=True), \
                 patch.object(rehearsal.subprocess, 'run', side_effect=successful_cleanup):
                rehearsal.cleanup_workspace(workspace, runner_temp, diagnostics)

            self.assertEqual(observed['TMPDIR'], str(context.image_copy_tmp_dir))
            self.assertNotEqual(observed['TMPDIR'], str(runner_temp))
            self.assertEqual(report['cleanup']['status'], 'passed')
            self.assertEqual(report['cleanup']['resources_remaining'], [])
            self.assertEqual(report['cleanup']['cleanup_helper_exit_code'], 0)

    def test_absent_run_scoped_workspace_is_recorded_as_already_clean(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-absent-') as temporary:
            runner_temp = Path(temporary).resolve()
            workspace = runner_temp / 'operatoros-deployment-rehearsal.123456789a1'
            report = {}
            with patch.object(rehearsal, 'REPORT', report), \
                 patch.dict(os.environ, {'GITHUB_RUN_ID': '123456789', 'GITHUB_RUN_ATTEMPT': '1'}, clear=True):
                rehearsal.cleanup_workspace(workspace, runner_temp, runner_temp / 'diagnostics')
            self.assertEqual(report['cleanup']['status'], 'passed')
            self.assertEqual(report['cleanup']['phase'], 'workspace_absent')
            self.assertTrue(report['cleanup']['ownership_validated'])
            self.assertEqual(report['cleanup']['resources_remaining'], [])

    def test_cleanup_result_parser_accepts_only_sanitized_allowlisted_values(self):
        record = {
            'attempted': True,
            'phase': 'workspace_validation',
            'failure_code': 'CLEANUP_PRIVATE_TMPDIR_MISMATCH',
            'exit_code': 1,
            'command_exit_code': None,
            'ownership_validated': False,
            'resources_removed': [],
            'resources_remaining': ['workspace_and_private_store'],
            'diagnostics_log_created': False,
            'status': 'failed',
            'expected': 'workspace_tmpdir',
            'observed': 'runner_temp',
        }
        self.assertTrue(rehearsal.valid_cleanup_result(record))
        record['observed'] = '/private/runner/path'
        self.assertFalse(rehearsal.valid_cleanup_result(record))

    def test_rehearsal_workspace_must_be_outside_protected_roots_before_creation(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-boundary-') as temporary:
            base = Path(temporary).resolve()
            runner_temp = base / 'runner-temp'
            runner_temp.mkdir(mode=0o700)
            workspace = runner_temp / 'operatoros-deployment-rehearsal.123456789a1'
            with patch.dict(os.environ, {}, clear=True):
                rehearsal.require_private_workspace_boundary(runner_temp, workspace)

            xdg_home = base / 'xdg'
            protected_runner_temp = xdg_home / 'containers/storage'
            protected_runner_temp.mkdir(parents=True, mode=0o700)
            protected_workspace = protected_runner_temp / 'operatoros-deployment-rehearsal.123456789a1'
            with patch.dict(os.environ, {'XDG_DATA_HOME': str(xdg_home)}, clear=True):
                with self.assertRaisesRegex(rehearsal.RehearsalError, 'overlaps shared Podman storage'):
                    rehearsal.require_private_workspace_boundary(protected_runner_temp, protected_workspace)

    def test_unverified_context_cleanup_never_invokes_podman(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-unverified-cleanup-') as temporary:
            runner_temp = Path(temporary).resolve()
            workspace = runner_temp / 'operatoros-deployment-rehearsal.123456789a1'
            workspace.mkdir(mode=0o700)
            (workspace / 'partial-setup').write_text('synthetic only', encoding='utf-8')
            unrelated = runner_temp / 'unrelated-resource'
            unrelated.write_text('preserve', encoding='utf-8')
            diagnostics = runner_temp / 'diagnostics'
            diagnostics.mkdir(mode=0o700)
            rehearsal.PODMAN_CONTEXT_VERIFIED = False
            with patch.object(rehearsal.subprocess, 'run') as run:
                rehearsal.cleanup_workspace(workspace, runner_temp, diagnostics)
            run.assert_not_called()
            self.assertFalse(workspace.exists())
            self.assertEqual(unrelated.read_text(encoding='utf-8'), 'preserve')

    def test_private_workspace_creation_failure_is_recorded_with_its_stage(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-workspace-failure-') as temporary:
            runner_temp = Path(temporary).resolve()
            workspace = runner_temp / 'operatoros-deployment-rehearsal.fixture01'
            diagnostics = runner_temp / 'operatoros-deployment-rehearsal-diagnostics.fixture01'
            diagnostics.mkdir(mode=0o700)
            report = {'schema_version': 2, 'checks': {}, 'failures': []}
            error_text = 'synthetic workspace failure detail'

            with patch.object(rehearsal, 'REPORT', report), \
                 patch.object(rehearsal, 'require_private_workspace_boundary',
                              side_effect=rehearsal.RehearsalError(error_text)):
                with self.assertRaises(RuntimeError) as error:
                    rehearsal.rehearse(
                        workspace, diagnostics,
                        ('operatoros-rehearsal-fixture-api.service',
                         'operatoros-rehearsal-fixture-caddy.service'),
                        set(), [],
                    )

                self.assertEqual(error.exception.code, 'CTX_WORKSPACE_FAILURE')
                self.assertEqual(error.exception.stage, 'workspace_creation')
                self.assertEqual(error.exception.last_completed_guard, 'none')
                rehearsal.retain_context_failure(error.exception)

            failure = report['podman_context']['failure']
            self.assertEqual(failure['code'], 'CTX_WORKSPACE_FAILURE')
            self.assertEqual(failure['stage'], 'workspace_creation')
            self.assertEqual(failure['last_completed_guard'], 'none')
            self.assertEqual(failure['observed'], 'unsafe')
            self.assertNotIn(error_text, json.dumps(failure))

    def test_structured_context_failure_updates_outer_guard_summary(self):
        report = {
            'podman_context': {
                'status': 'qualifying',
                'stage': 'podman_store_validation',
                'last_completed_guard': 'podman_info_parsed',
            },
        }
        error = deploy.PodmanContextError(
            'CTX_GRAPHROOT_MISMATCH', 'podman_store_validation',
            'rootless_runtime_validated', expected='private_graphroot', observed='different_path',
        )

        with patch.object(rehearsal, 'REPORT', report):
            rehearsal.retain_context_failure(error)

        summary = report['podman_context']
        self.assertEqual(summary['stage'], summary['failure']['stage'])
        self.assertEqual(summary['last_completed_guard'], summary['failure']['last_completed_guard'])
        self.assertEqual(summary['last_completed_guard'], 'rootless_runtime_validated')

    def test_podman_secret_stdin_and_subprocess_outputs_never_enter_logs_or_errors(self):
        secret_value = 'synthetic-secret-value'
        child_output = 'synthetic-child-output-marker'
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-diagnostics-test-') as temporary:
            diagnostics = Path(temporary)
            success = subprocess.CompletedProcess([], 0, child_output, child_output)
            with patch.object(rehearsal, 'DIAGNOSTICS', diagnostics), \
                 patch.object(rehearsal.subprocess, 'run', return_value=success) as command:
                rehearsal.create_podman_secret(
                    'operatoros-rehearsal-auth', secret_value, {'HOME': '/private'},
                )

            args = command.call_args.args[0]
            self.assertEqual(args, ['podman', 'secret', 'create', 'operatoros-rehearsal-auth', '-'])
            self.assertNotIn(secret_value, args)
            self.assertEqual(command.call_args.kwargs['input'], secret_value)
            self.assertNotIn(child_output, (diagnostics / 'rehearsal.log').read_text())

            failure = subprocess.CompletedProcess([], 23, child_output, child_output)
            with patch.object(rehearsal, 'DIAGNOSTICS', diagnostics), \
                 patch.object(rehearsal.subprocess, 'run', return_value=failure):
                with self.assertRaises(rehearsal.RehearsalError) as error:
                    rehearsal.create_podman_secret(
                        'operatoros-rehearsal-auth', secret_value, {'HOME': '/private'},
                    )
            self.assertNotIn(secret_value, str(error.exception))
            self.assertNotIn(child_output, str(error.exception))
            self.assertNotIn(child_output, (diagnostics / 'rehearsal.log').read_text())

    def test_deployment_cli_failure_does_not_log_token_or_child_output(self):
        token = 'synthetic-release-token-marker'
        child_output = 'synthetic-cli-output-marker'
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-cli-test-') as temporary:
            diagnostics = Path(temporary)
            result = subprocess.CompletedProcess([], 23, child_output, child_output)
            stdout = io.StringIO()
            with patch.object(rehearsal, 'DIAGNOSTICS', diagnostics), \
                 patch.dict(os.environ, {'PATH': '/usr/bin:/bin', 'OPERATOROS_RELEASE_TOKEN': token}, clear=True), \
                 patch.object(rehearsal.subprocess, 'run', return_value=result) as command, \
                 redirect_stdout(stdout):
                with self.assertRaisesRegex(rehearsal.RehearsalError, 'non-secret rehearsal log') as error:
                    rehearsal.run_cli(['operatoros-deploy', 'verify'], needs_token=True)

            self.assertNotIn(token, command.call_args.args[0])
            self.assertEqual(command.call_args.kwargs['env']['OPERATOROS_RELEASE_TOKEN'], token)
            self.assertNotIn(token, str(error.exception))
            self.assertNotIn(child_output, str(error.exception))
            self.assertNotIn(token, stdout.getvalue())
            self.assertNotIn(child_output, stdout.getvalue())
            diagnostic = (diagnostics / 'rehearsal.log').read_text()
            self.assertNotIn(token, diagnostic)
            self.assertNotIn(child_output, diagnostic)

    def test_successful_secret_setup_keeps_credentials_out_of_files_arguments_and_logs(self):
        child_output = 'synthetic-subprocess-output-marker'
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-secret-success-') as temporary:
            root = Path(temporary)
            workspace = root / 'operatoros-deployment-rehearsal.fixture01'
            workspace.mkdir(mode=0o700)
            context = private_context(workspace)
            diagnostics = root / 'diagnostics'
            diagnostics.mkdir(mode=0o700)
            report = {}
            calls = []

            def successful_process(args, **kwargs):
                calls.append((args, kwargs))
                if args[:3] == ['bun', 'packages/db/src/db-cli.ts', 'bootstrap']:
                    data_dir = Path(kwargs['env']['OPERATOROS_DATA_DIR'])
                    self.assertEqual(
                        list(data_dir.iterdir()), [],
                        'db-cli bootstrap requires an empty synthetic data directory',
                    )
                    (data_dir / 'operatoros.sqlite').write_bytes(b'synthetic database')
                return subprocess.CompletedProcess(args, 0, child_output, child_output)

            with patch.object(rehearsal, 'DIAGNOSTICS', diagnostics), \
                 patch.object(rehearsal, 'REPORT', report), \
                 patch.dict(os.environ, {
                     'GITHUB_RUN_ID': '123456789',
                     'GITHUB_RUN_ATTEMPT': '1',
                     'OPERATOROS_REHEARSAL_ORIGIN': 'http://127.0.0.1:18080',
                     'PATH': '/usr/bin:/bin',
                 }, clear=True), \
                 patch.object(rehearsal.subprocess, 'run', side_effect=successful_process):
                username, password, cookie_secret, backup_key, auth_name, backup_name = \
                    rehearsal.setup_synthetic_database(workspace, SHA, context)

            self.assertEqual(len(calls), 5)
            self.assertTrue(report['synthetic_database_setup']['schema_verification_completed'])
            self.assertEqual(report['synthetic_database_setup']['status'], 'completed')
            secret_calls = calls[:2]
            self.assertEqual(secret_calls[0][0], ['podman', 'secret', 'create', auth_name, '-'])
            self.assertEqual(secret_calls[1][0], ['podman', 'secret', 'create', backup_name, '-'])
            self.assertEqual(secret_calls[0][1]['input'], cookie_secret)
            self.assertEqual(secret_calls[1][1]['input'], backup_key)
            seed_args, seed_kwargs = calls[3]
            self.assertNotIn(password, seed_args)
            self.assertEqual(seed_kwargs['env']['OPERATOROS_E2E_ADMIN_PASSWORD'], password)
            self.assertEqual(seed_kwargs['env']['OPERATOROS_E2E_ADMIN_USERNAME'], username)
            for args, _ in calls:
                for value in (password, cookie_secret, backup_key):
                    self.assertNotIn(value, args)

            api_env = (workspace / 'deploy/api.env').read_text()
            self.assertNotIn(password, api_env)
            self.assertNotIn(cookie_secret, api_env)
            self.assertNotIn(backup_key, api_env)
            self.assertNotIn('AUTH_COOKIE_SECRET=', api_env)
            self.assertNotIn('BACKUP_ENCRYPTION_KEY=', api_env)
            persisted = [path.read_bytes() for path in workspace.rglob('*') if path.is_file()]
            for value in (password, cookie_secret, backup_key):
                self.assertFalse(any(value.encode() in contents for contents in persisted))
            diagnostic = (diagnostics / 'rehearsal.log').read_text()
            self.assertNotIn(child_output, diagnostic)
            for value in (password, cookie_secret, backup_key):
                self.assertNotIn(value, diagnostic)

    def test_diagnostic_logger_rejects_unapproved_dynamic_text(self):
        with self.assertRaisesRegex(rehearsal.RehearsalError, 'not allowlisted'):
            rehearsal.log('synthetic-password-or-cookie-secret')

    def test_api_environment_contains_no_authentication_or_backup_secrets(self):
        values = rehearsal.api_environment(SHA, 'http://127.0.0.1:18080')
        rendered = ''.join(f'{key}={value}\n' for key, value in values.items())

        self.assertNotIn('AUTH_COOKIE_SECRET', values)
        self.assertNotIn('BACKUP_ENCRYPTION_KEY', values)
        self.assertNotIn('Synthetic-', rendered)
        self.assertIn('BACKUP_ENCRYPTION_KEY_ID=', rendered)

    def test_quadlet_references_run_scoped_podman_secrets_without_values(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-secret-test-') as temporary:
            workspace = Path(temporary) / 'workspace'
            workspace.mkdir(mode=0o700)
            (workspace / 'data').mkdir(mode=0o700)
            context = private_context(workspace)
            unit_dir = Path(temporary) / 'units'
            unit_dir.mkdir()
            api_unit, caddy_unit, api_copy = rehearsal.write_quadlets(
                workspace, unit_dir, 'operatoros-rehearsal-api.service',
                'operatoros-rehearsal-caddy.service', 18081, 18080,
                'localhost/operatoros-api:' + SHA,
                'operatoros-rehearsal-auth', 'operatoros-rehearsal-backup', set(),
                context,
            )

            rendered = (api_unit.read_text(encoding='utf-8') + caddy_unit.read_text(encoding='utf-8') +
                        api_copy.read_text(encoding='utf-8'))
            self.assertIn('Secret=operatoros-rehearsal-auth,type=env,target=AUTH_COOKIE_SECRET', rendered)
            self.assertIn('Secret=operatoros-rehearsal-backup,type=env,target=BACKUP_ENCRYPTION_KEY', rendered)
            self.assertNotIn('synthetic-secret-value', rendered)
            for name, value in context.environment().items():
                self.assertEqual(rendered.count(f'Environment={name}={value}'), 3)
            self.assertNotIn('XDG_RUNTIME_DIR=', rendered)

    def test_effective_quadlet_environment_must_match_private_podman_context(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-unit-env-') as temporary:
            workspace = Path(temporary) / 'operatoros-deployment-rehearsal.fixture01'
            workspace.mkdir(mode=0o700)
            context = private_context(workspace)
            valid = 'PATH=/usr/bin:/bin ' + ' '.join(
                f'{name}={value}' for name, value in context.environment().items()
            )
            self.assertNotIn('CONTAINERS_STORAGE_CONF', context.environment())
            rehearsal.verify_quadlet_podman_environment(valid, context)

            wrong = valid.replace(
                str(context.xdg_config_home),
                '/home/runner/.config',
            )
            with self.assertRaisesRegex(rehearsal.RehearsalError, 'differs'):
                rehearsal.verify_quadlet_podman_environment(wrong, context)

            override = valid + f' CONTAINERS_STORAGE_CONF={context.storage_conf}'
            with self.assertRaisesRegex(rehearsal.RehearsalError, 'override'):
                rehearsal.verify_quadlet_podman_environment(override, context)

            missing = ' '.join(
                f'{name}={value}' for name, value in context.environment().items()
                if name != 'XDG_DATA_HOME'
            )
            with self.assertRaisesRegex(rehearsal.RehearsalError, 'differs'):
                rehearsal.verify_quadlet_podman_environment(missing, context)

    def test_synthetic_login_uses_memory_request_and_cookie_jar(self):
        class Response(io.BytesIO):
            status = 200

        username = 'synthetic-admin'
        password = 'synthetic-password-only-in-memory'
        login_response = Response(json.dumps({'username': username, 'role': 'admin'}).encode())
        current_response = Response(b'{}')
        opener = Mock()
        opener.open.side_effect = [login_response, current_response]

        with patch.object(rehearsal, 'build_opener', return_value=opener) as build:
            rehearsal.login_synthetic_admin('http://127.0.0.1:18080', username, password)

        handlers = build.call_args.args
        cookie_handler = next(handler for handler in handlers
                              if isinstance(handler, rehearsal.HTTPCookieProcessor))
        self.assertIsInstance(cookie_handler.cookiejar, rehearsal.CookieJar)
        login_request = opener.open.call_args_list[0].args[0]
        self.assertEqual(login_request.full_url, 'http://127.0.0.1:18080/api/auth/login')
        self.assertIn(password.encode(), login_request.data)
        self.assertNotIn(password, repr(login_request.headers))
        self.assertEqual(opener.open.call_args_list[1].args[0].full_url,
                         'http://127.0.0.1:18080/api/auth/me')

    def test_rehearsal_does_not_persist_login_or_cookie_files(self):
        script = (ROOT / 'scripts/deployment-rehearsal.py').read_text(encoding='utf-8')
        self.assertNotIn('synthetic-login-request.json', script)
        self.assertNotIn('synthetic-login-response.json', script)
        self.assertNotIn('synthetic-cookie-jar.txt', script)
        self.assertNotIn('--cookie-jar', script)
        self.assertNotIn('--data-binary', script)

    def test_partial_secret_setup_keeps_values_private_and_reports_only_exit_code(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-partial-setup-') as temporary:
            root = Path(temporary)
            workspace = root / 'operatoros-deployment-rehearsal.fixture01'
            workspace.mkdir(mode=0o700)
            context = private_context(workspace)
            diagnostics = root / 'diagnostics'
            diagnostics.mkdir(mode=0o700)
            report = {}
            calls = []

            def fail_second_secret(args, **kwargs):
                calls.append((args, kwargs))
                return subprocess.CompletedProcess(
                    args, 0 if len(calls) == 1 else 23,
                    'synthetic-podman-output-marker', 'synthetic-podman-output-marker',
                )

            with patch.object(rehearsal, 'DIAGNOSTICS', diagnostics), \
                 patch.object(rehearsal, 'REPORT', report), \
                 patch.dict(os.environ, {
                     'GITHUB_RUN_ID': '123456789',
                     'GITHUB_RUN_ATTEMPT': '1',
                     'OPERATOROS_REHEARSAL_ORIGIN': 'http://127.0.0.1:18080',
                     'PATH': '/usr/bin:/bin',
                 }, clear=True), \
                 patch.object(rehearsal.subprocess, 'run', side_effect=fail_second_secret):
                with self.assertRaisesRegex(rehearsal.RehearsalError, 'exit code 23'):
                    rehearsal.setup_synthetic_database(workspace, SHA, context)

            self.assertEqual(len(calls), 2)
            setup = report['synthetic_database_setup']
            self.assertEqual(setup['failure']['operation_id'], 'DB_SETUP_BACKUP_SECRET_CREATE')
            self.assertEqual(setup['failure']['code'], 'DB_SETUP_BACKUP_SECRET_CREATE_FAILED')
            self.assertEqual(setup['failure']['classification'], 'container_command_failed')
            secret_values = [call[1]['input'] for call in calls]
            for args, kwargs in calls:
                self.assertEqual(args[-1], '-')
                self.assertNotIn('CONTAINERS_STORAGE_CONF', kwargs['env'])
                self.assertEqual(kwargs['env']['XDG_CONFIG_HOME'], str(context.xdg_config_home))
                self.assertTrue(Path(kwargs['env']['CONTAINERS_CONF']).is_relative_to(workspace))
                self.assertEqual(kwargs['env']['XDG_DATA_HOME'], str(context.xdg_data_home))
                self.assertNotIn('AUTH_COOKIE_SECRET', kwargs['env'])
                self.assertNotIn('BACKUP_ENCRYPTION_KEY', kwargs['env'])
            self.assertFalse((workspace / 'deploy/api.env').exists())
            file_contents = [path.read_bytes() for path in workspace.rglob('*') if path.is_file()]
            for value in secret_values:
                self.assertFalse(any(value.encode() in contents for contents in file_contents))
            diagnostic = (diagnostics / 'rehearsal.log').read_text()
            self.assertIn('subprocess exit=23', diagnostic)
            self.assertIn('operation=DB_SETUP_BACKUP_SECRET_CREATE status=failed exit=23', diagnostic)
            self.assertNotIn('synthetic-podman-output-marker', diagnostic)
            self.assertNotIn('synthetic-podman-output-marker', json.dumps(report))
            for value in secret_values:
                self.assertNotIn(value, diagnostic)

    def test_main_runs_cleanup_after_interruption_without_uploading_raw_outputs(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-interruption-') as temporary:
            runner_temp = Path(temporary) / 'runner-temp'
            runner_temp.mkdir(mode=0o700)
            diagnostics = runner_temp / 'operatoros-deployment-rehearsal-diagnostics.fixture01'
            diagnostics.mkdir(mode=0o700)
            workspace = runner_temp / 'operatoros-deployment-rehearsal.fixture01'
            services = ('operatoros-rehearsal-fixture-api.service',
                        'operatoros-rehearsal-fixture-caddy.service')
            report = {'schema_version': 1, 'checks': {}, 'failures': []}

            with patch.object(rehearsal, 'REPORT', report), \
                 patch.object(rehearsal, 'DIAGNOSTICS', None), \
                 patch.object(rehearsal, 'validate_workflow_context',
                              return_value=(runner_temp, workspace, diagnostics, services)), \
                 patch.object(rehearsal, 'preflight_runner', return_value={}), \
                 patch.object(rehearsal, 'rehearse', side_effect=KeyboardInterrupt), \
                 patch.object(rehearsal, 'cleanup_workspace') as cleanup:
                with self.assertRaises(KeyboardInterrupt):
                    rehearsal.main()

            cleanup.assert_called_once_with(workspace, runner_temp, diagnostics)
            evidence = json.loads((diagnostics / 'rehearsal-evidence.json').read_text())
            self.assertEqual(evidence['failures'], [])
            self.assertFalse((diagnostics / 'deploy-result.json').exists())

    def test_main_sanitizes_exception_text_and_cleanup_failures_in_evidence(self):
        secret = 'synthetic-exception-secret-marker'
        cleanup_secret = 'synthetic-cleanup-secret-marker'
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-error-test-') as temporary:
            runner_temp = Path(temporary) / 'runner-temp'
            runner_temp.mkdir(mode=0o700)
            diagnostics = runner_temp / 'operatoros-deployment-rehearsal-diagnostics.fixture01'
            diagnostics.mkdir(mode=0o700)
            workspace = runner_temp / 'operatoros-deployment-rehearsal.fixture01'
            services = ('operatoros-rehearsal-fixture-api.service',
                        'operatoros-rehearsal-fixture-caddy.service')
            report = {'schema_version': 1, 'checks': {}, 'failures': []}
            stderr = io.StringIO()

            def fail_after_import(*_args):
                report['deployment'] = rehearsal.initial_deployment_record()
                report['deployment']['status'] = 'in_progress'
                rehearsal.deployment_progress('oci_import_started', completed_guard='podman_context_accepted',
                                              oci_import='started')
                raise rehearsal.RehearsalError(secret)

            with patch.object(rehearsal, 'REPORT', report), \
                 patch.object(rehearsal, 'DIAGNOSTICS', None), \
                 patch.object(rehearsal, 'validate_workflow_context',
                              return_value=(runner_temp, workspace, diagnostics, services)), \
                 patch.object(rehearsal, 'preflight_runner', return_value={}), \
                 patch.object(rehearsal, 'rehearse', side_effect=fail_after_import), \
                 patch.object(rehearsal, 'cleanup_workspace',
                              side_effect=rehearsal.RehearsalError(cleanup_secret)), \
                 redirect_stderr(stderr):
                self.assertEqual(rehearsal.main(), 1)

            evidence = (diagnostics / 'rehearsal-evidence.json').read_text()
            self.assertIn('RehearsalError', evidence)
            self.assertNotIn(secret, evidence)
            self.assertNotIn(cleanup_secret, evidence)
            self.assertNotIn(secret, stderr.getvalue())
            self.assertNotIn(cleanup_secret, stderr.getvalue())
            retained = json.loads(evidence)
            self.assertEqual(retained['deployment']['failure']['code'], 'DEPLOY_OCI_IMPORT_FAILED')
            self.assertEqual(retained['deployment']['failure']['last_completed_guard'], 'podman_context_accepted')
            self.assertEqual(retained['cleanup']['failure_code'], 'CLEANUP_WORKSPACE_FAILED')
            self.assertEqual(retained['cleanup']['status'], 'failed')

    def test_main_records_cleanup_outcome_alongside_database_setup_failure(self):
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-database-cleanup-') as temporary:
            runner_temp = Path(temporary) / 'runner-temp'
            runner_temp.mkdir(mode=0o700)
            diagnostics = runner_temp / 'operatoros-deployment-rehearsal-diagnostics.fixture01'
            diagnostics.mkdir(mode=0o700)
            workspace = runner_temp / 'operatoros-deployment-rehearsal.fixture01'
            services = ('operatoros-rehearsal-fixture-api.service',
                        'operatoros-rehearsal-fixture-caddy.service')
            report = {'schema_version': 2, 'checks': {}, 'failures': []}

            def fail_database_setup(*_args):
                report['deployment'] = rehearsal.initial_deployment_record()
                report['deployment'].update({
                    'status': 'in_progress',
                    'phase': 'synthetic_database_setup_started',
                    'last_completed_guard': 'runtime_image_pulled',
                })
                report['synthetic_database_setup'] = rehearsal.initial_synthetic_database_setup_record()
                report['synthetic_database_setup'].update({
                    'status': 'failed',
                    'current_operation': 'DB_SETUP_DATABASE_BOOTSTRAP',
                    'last_completed_operation': 'DB_SETUP_API_ENV_STAGE',
                    'database_initializer_started': True,
                    'failure': {
                        'code': 'DB_SETUP_DATABASE_BOOTSTRAP_FAILED',
                        'operation_id': 'DB_SETUP_DATABASE_BOOTSTRAP',
                        'exception_class': 'SubprocessExit',
                        'exit_code': 1,
                        'classification': 'unexpected_nonempty_data_root',
                    },
                })
                error = rehearsal.RehearsalError('synthetic database setup failed')
                error.exit_code = 1
                raise error

            def cleanup_succeeds(*_args):
                report['cleanup'] = {'attempted': True, 'status': 'passed', 'exit_code': 0}

            with patch.object(rehearsal, 'REPORT', report), \
                 patch.object(rehearsal, 'DIAGNOSTICS', None), \
                 patch.object(rehearsal, 'validate_workflow_context',
                              return_value=(runner_temp, workspace, diagnostics, services)), \
                 patch.object(rehearsal, 'preflight_runner', return_value={}), \
                 patch.object(rehearsal, 'rehearse', side_effect=fail_database_setup), \
                 patch.object(rehearsal, 'cleanup_workspace', side_effect=cleanup_succeeds):
                self.assertEqual(rehearsal.main(), 1)

            retained = json.loads((diagnostics / 'rehearsal-evidence.json').read_text())
            self.assertEqual(retained['deployment']['failure']['operation_failure_code'],
                             'DB_SETUP_DATABASE_BOOTSTRAP_FAILED')
            self.assertEqual(retained['synthetic_database_setup']['cleanup_status'], 'passed')
            self.assertEqual(retained['cleanup']['status'], 'passed')

    def test_main_retains_structured_context_failure_and_cleanup_status(self):
        secret = 'synthetic-podman-output-secret'
        with tempfile.TemporaryDirectory(prefix='operatoros-rehearsal-context-diagnostic-') as temporary:
            runner_temp = Path(temporary) / 'runner-temp'
            runner_temp.mkdir(mode=0o700)
            diagnostics = runner_temp / 'operatoros-deployment-rehearsal-diagnostics.fixture01'
            diagnostics.mkdir(mode=0o700)
            workspace = runner_temp / 'operatoros-deployment-rehearsal.fixture01'
            services = ('operatoros-rehearsal-fixture-api.service',
                        'operatoros-rehearsal-fixture-caddy.service')
            report = {'schema_version': 1, 'checks': {}, 'failures': []}
            error = deploy.PodmanContextError(
                'CTX_PODMAN_INFO_FAILURE', 'podman_info', 'private_environment_verified',
                exit_code=17, expected='successful_podman_info', observed='command_failed',
            )
            error.stderr = secret

            def fail_context(*args):
                report['podman_context'] = {
                    'stage': 'podman_info',
                    'last_completed_guard': 'private_environment_verified',
                    'status': 'qualifying',
                    'cleanup_status': 'not_started',
                }
                raise error

            with patch.object(rehearsal, 'REPORT', report), \
                 patch.object(rehearsal, 'DIAGNOSTICS', None), \
                 patch.object(rehearsal, 'validate_workflow_context',
                              return_value=(runner_temp, workspace, diagnostics, services)), \
                 patch.object(rehearsal, 'preflight_runner', return_value={}), \
                 patch.object(rehearsal, 'rehearse', side_effect=fail_context), \
                 patch.object(rehearsal, 'cleanup_workspace'):
                self.assertEqual(rehearsal.main(), 1)

            evidence = (diagnostics / 'rehearsal-evidence.json').read_text()
            record = json.loads(evidence)['podman_context']
            failure = record.get('failure', {})
            self.assertEqual(failure.get('code'), 'CTX_PODMAN_INFO_FAILURE')
            self.assertEqual(failure.get('stage'), 'podman_info')
            self.assertEqual(failure.get('last_completed_guard'), 'private_environment_verified')
            self.assertEqual(failure.get('exit_code'), 17)
            self.assertEqual(failure.get('expected'), 'successful_podman_info')
            self.assertEqual(failure.get('observed'), 'command_failed')
            self.assertEqual(record.get('cleanup_status'), 'passed')
            self.assertNotIn(secret, evidence)

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
        self.assertNotIn('deploy-result.json', job)

    def test_deployment_rehearsal_pins_existing_artifact_and_never_builds_or_deploys_live(self):
        script = (ROOT / 'scripts/deployment-rehearsal.py').read_text()
        for identity in (
            'b9718ab1a6f8b1d855c8a5c62e973bfad2f8ea84',
            '42181508155',
            '13485579515',
            '0d66097da4bff85b4bb0915c39c819b9d069cf34f16688b0b9e29f5c7594bd39',
            '0ff8033c51900e0e3154f06e428ea8120f12b906a906938f1458ff058498bbf4',
            'sha256:acf22409b2a2f957830533c778198cdde5c342664d886526c38f8a4336c5a0ed',
            'sha256:8c8dfce496c1f304a2b157603d0b6b239fadf540e9824cc1414d0addf31621c6',
            '8c23256063f803a52590ba5fe432f51e519cc6d475af058ae5240f896eeb2ecc',
            '2027-02-04T07:32:13Z',
        ):
            self.assertIn(identity, script)
        self.assertIn('deploy.verified_artifact(request', script)
        self.assertIn('"manifest_sha256": hashlib.sha256(verified.files["manifest.json"]).hexdigest()', script)
        self.assertIn('"artifact_checksums": manifest["artifacts"]', script)
        self.assertIn('"attestation": "verified"', script)
        self.assertIn('verified.envelope_sha256 == ENVELOPE_SHA256', script)
        self.assertIn('verified.bundle_sha256 == INNER_BUNDLE_SHA256', script)
        self.assertIn('manifest.get("workflow") == REPOSITORY + "/.github/workflows/ci.yml"', script)
        self.assertIn('SQLITE_ASSERTION', script)
        self.assertIn('PRAGMA journal_mode=WAL', script)
        self.assertIn('If-None-Match', script)
        self.assertIn('"quadlet_restart"', script)
        self.assertIn('"locked_application_state_unchanged"', script)
        self.assertIn('"sqlite_after_interrupted_recovery"', script)
        self.assertIn('"interrupted_transaction_recovered"', script)
        self.assertIn('interrupted deployment could not restore its recorded previous release', script)
        self.assertLess(script.index('verified = deploy.verified_artifact'),
                        script.index('context = deploy.create_private_podman_context(workspace)'))
        self.assertLess(script.index('context = deploy.create_private_podman_context(workspace)'),
                        script.index('image_ref = image_identity_for_release'))
        self.assertIn('OPERATOROS_REHEARSAL_CONFIRMED', script)
        self.assertIn('RUNNER_TEMP', script)
        self.assertIn('podman-rootless/graphroot', script)
        self.assertIn('show-environment', script)
        self.assertIn('OPERATOROS_RELEASE_TOKEN', script)
        self.assertIn('REGISTRY_AUTH_FILE', (ROOT / 'scripts/operatoros_deploy.py').read_text())
        deploy_source = (ROOT / 'scripts/operatoros_deploy.py').read_text()
        self.assertIn('"manifest_sha256": hashlib.sha256(release.files["manifest.json"]).hexdigest()', deploy_source)
        self.assertIn('"artifact_expires_at": release.artifact_expires_at', deploy_source)
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

    def test_podman_cleanup_environment_keeps_host_xdg_guard_but_not_secrets(self):
        with unittest.mock.patch.dict(os.environ, {
            'OPERATOROS_REHEARSAL_HOST_XDG_DATA_HOME': '/home/runner/.local/share',
            'GITHUB_TOKEN': 'synthetic-token-must-not-propagate',
            'AUTH_COOKIE_SECRET': 'synthetic-cookie-must-not-propagate',
        }, clear=True):
            environment = cleanup.command_environment()
        self.assertEqual(environment['OPERATOROS_REHEARSAL_HOST_XDG_DATA_HOME'], '/home/runner/.local/share')
        self.assertNotIn('GITHUB_TOKEN', environment)
        self.assertNotIn('AUTH_COOKIE_SECRET', environment)

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
            self.assertEqual(cleanup.CLEANUP_RESULT['status'], 'passed')
            self.assertTrue(cleanup.CLEANUP_RESULT['ownership_validated'])
            self.assertEqual(cleanup.CLEANUP_RESULT['resources_remaining'], [])
            self.assertEqual(cleanup.CLEANUP_RESULT['resources_removed'], [
                'run_scoped_containers', 'private_store_contents', 'workspace',
            ])
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

    def test_cleanup_result_reports_log_created_during_cleanup(self):
        diagnostics = self.temp_parent / 'release-diagnostics'
        def logged_fake_podman(arguments, workspace, log_path):
            result = self.fake_podman(arguments, workspace, log_path)
            if arguments[0] == 'rm':
                cleanup.append_log(log_path, 'synthetic container removal completed')
            return result

        with unittest.mock.patch.dict(os.environ, self.environment, clear=True), \
             unittest.mock.patch.object(cleanup, 'run_podman', side_effect=logged_fake_podman):
            self.assertEqual(cleanup.cleanup(
                str(self.workspace), str(self.temp_parent), str(diagnostics),
            ), 0)

        self.assertTrue((diagnostics / 'consumer-cleanup.log').is_file())
        self.assertTrue(cleanup.CLEANUP_RESULT['diagnostics_log_created'])

    def test_deployment_rehearsal_profile_cleans_only_its_scoped_containers(self):
        workspace = self.temp_parent / 'operatoros-deployment-rehearsal.123456789a1'
        workspace.mkdir(mode=0o700)
        context = private_context(workspace)
        environment = self.environment | context.environment()
        environment.pop('CONTAINERS_STORAGE_CONF', None)
        with unittest.mock.patch.dict(os.environ, environment, clear=True), \
             unittest.mock.patch.object(cleanup, 'run_podman', side_effect=self.fake_podman):
            self.assertEqual(cleanup.cleanup(str(workspace), str(self.temp_parent)), 0)
        self.assertFalse(workspace.exists())
        self.assertEqual(cleanup.CLEANUP_RESULT['status'], 'passed')
        self.assertEqual(cleanup.CLEANUP_RESULT['resources_remaining'], [])
        self.assertEqual(self.external.read_text(encoding='utf-8'), 'preserve')
        self.assertEqual(self.commands[0], [
            'rm', '--force', '--ignore', 'operatoros-lite-api', 'operatoros-lite-caddy',
        ])

    def test_deployment_rehearsal_cleanup_rejects_storage_config_override(self):
        workspace = self.temp_parent / 'operatoros-deployment-rehearsal.123456789a1'
        workspace.mkdir(mode=0o700)
        context = private_context(workspace)
        environment = self.environment | context.environment()
        environment['CONTAINERS_STORAGE_CONF'] = str(context.storage_conf)
        with unittest.mock.patch.dict(os.environ, environment, clear=True), \
             unittest.mock.patch.object(cleanup, 'run_podman') as run:
            self.assertEqual(cleanup.cleanup(str(workspace), str(self.temp_parent)), 1)
            run.assert_not_called()
        self.assertTrue(workspace.exists())
        self.assertEqual(cleanup.CLEANUP_RESULT['failure_code'], 'CLEANUP_OWNERSHIP_REJECTED')
        self.assertFalse(cleanup.CLEANUP_RESULT['ownership_validated'])

    def test_rehearsal_cleanup_classifies_private_tmpdir_mismatch_before_log_creation(self):
        workspace = self.temp_parent / 'operatoros-deployment-rehearsal.123456789a1'
        workspace.mkdir(mode=0o700)
        context = private_context(workspace)
        environment = self.environment | context.environment()
        environment.pop('CONTAINERS_STORAGE_CONF', None)
        environment['TMPDIR'] = str(self.temp_parent)
        diagnostics = self.temp_parent / 'operatoros-deployment-rehearsal-diagnostics.123456789a1'
        with unittest.mock.patch.dict(os.environ, environment, clear=True), \
             unittest.mock.patch.object(cleanup, 'run_podman') as run:
            self.assertEqual(cleanup.cleanup(str(workspace), str(self.temp_parent), str(diagnostics)), 1)
            run.assert_not_called()
        self.assertEqual(cleanup.CLEANUP_RESULT['failure_code'], 'CLEANUP_PRIVATE_TMPDIR_MISMATCH')
        self.assertEqual(cleanup.CLEANUP_RESULT['expected'], 'workspace_tmpdir')
        self.assertEqual(cleanup.CLEANUP_RESULT['observed'], 'runner_temp')
        self.assertFalse(cleanup.CLEANUP_RESULT['diagnostics_log_created'])
        self.assertFalse((diagnostics / 'consumer-cleanup.log').exists())
        self.assertTrue(workspace.exists())

    def test_deployment_rehearsal_rejects_unsafe_store_with_cleanup_error(self):
        workspace = self.temp_parent / 'operatoros-deployment-rehearsal.123456789a1'
        workspace.mkdir(mode=0o700)
        context = private_context(workspace)
        external_store = self.temp_parent / 'external-store'
        external_store.mkdir()
        context.graphroot.rmdir()
        context.graphroot.symlink_to(external_store, target_is_directory=True)
        environment = self.environment | context.environment()
        environment.pop('CONTAINERS_STORAGE_CONF', None)
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(cleanup.CleanupError, 'graphroot path'):
                cleanup.validate_workspace(str(workspace), str(self.temp_parent))
        with patch.object(cleanup, 'validate_workspace', return_value=(workspace, self.temp_parent, context.storage_conf)):
            with self.assertRaisesRegex(cleanup.CleanupError, 'graphroot'):
                cleanup.remove_store_in_user_namespace(workspace, self.temp_parent)
        self.assertTrue(external_store.is_dir())

    def test_cleanup_command_failure_is_reported_even_if_store_is_removed(self):
        self.rm_status = 9
        with unittest.mock.patch('sys.stderr', new_callable=io.StringIO) as error:
            self.assertEqual(self.run_cleanup(), 1)
            self.assertIn('exit=9', error.getvalue())
        self.assertFalse(self.workspace.exists())
        self.assertEqual(cleanup.CLEANUP_RESULT['failure_code'], 'CLEANUP_PODMAN_REMOVE_FAILED')
        self.assertEqual(cleanup.CLEANUP_RESULT['command_exit_code'], 9)
        self.assertEqual(cleanup.CLEANUP_RESULT['resources_remaining'], [])

    def test_cleanup_result_survives_diagnostic_log_creation_failure(self):
        with unittest.mock.patch.object(cleanup, 'diagnostic_log', side_effect=OSError('private path detail')):
            self.assertEqual(self.run_cleanup(), 1)
        self.assertFalse(self.workspace.exists())
        self.assertEqual(cleanup.CLEANUP_RESULT['failure_code'], 'CLEANUP_LOG_UNAVAILABLE')
        self.assertFalse(cleanup.CLEANUP_RESULT['diagnostics_log_created'])
        self.assertEqual(cleanup.CLEANUP_RESULT['resources_removed'], [
            'run_scoped_containers', 'private_store_contents', 'workspace',
        ])
        self.assertEqual(cleanup.CLEANUP_RESULT['resources_remaining'], [])

    def test_cleanup_cli_emits_sanitized_result_when_cleanup_raises_before_logging(self):
        secret = 'sensitive-cleanup-exception-detail'
        output = io.StringIO()
        with patch.object(sys, 'argv', ['release-consumer-cleanup.py', '/unsafe/workspace', '/tmp']), \
             patch.object(cleanup, 'cleanup', side_effect=OSError(secret)), \
             redirect_stdout(output):
            self.assertEqual(cleanup.main(), 1)
        record_lines = [line for line in output.getvalue().splitlines()
                        if line.startswith('OPERATOROS_CLEANUP_RESULT=')]
        self.assertEqual(len(record_lines), 1)
        record = json.loads(record_lines[0].split('=', 1)[1])
        self.assertEqual(record['failure_code'], 'CLEANUP_UNHANDLED_FAILURE')
        self.assertEqual(record['exception_class'], 'OSError')
        self.assertEqual(record['status'], 'failed')
        self.assertNotIn(secret, output.getvalue())

    def test_remaining_container_or_mount_blocks_filesystem_cleanup(self):
        self.containers_output = 'unexpected-container\n'
        self.assertEqual(self.run_cleanup(), 1)
        self.assertTrue(self.workspace.exists())
        self.assertEqual(cleanup.CLEANUP_RESULT['failure_code'], 'CLEANUP_CONTAINERS_REMAIN_OR_UNKNOWN')
        self.assertIn('containers_or_unverified_inventory', cleanup.CLEANUP_RESULT['resources_remaining'])
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
