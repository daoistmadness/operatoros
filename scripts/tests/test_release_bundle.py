import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('release', ROOT / 'scripts/release-bundle.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
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
    config = blob({'architecture': 'amd64', 'os': 'linux', 'config': {'Labels': {'org.opencontainers.image.revision': SHA, 'org.operatoros.source.dirty': 'false', 'org.operatoros.source.tree-sha256': 'b' * 64}}})
    manifest = blob({'config': config, 'layers': []})
    blobs['index.json'] = json.dumps({'manifests': [manifest]}).encode()
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
