#!/usr/bin/env python3
"""Build CI release bundles and verify them before container import."""
import argparse
import hashlib
import gzip
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile

REPO = 'daoistmadness/operatoros'
WORKFLOW = REPO + '/.github/workflows/ci.yml'
SCANNER = 'ghcr.io/aquasecurity/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c'
FILES = {'operatoros-api.oci.tar', 'operatoros-web-client.tar.gz', 'sbom.cdx.json', 'scan.json', 'manifest.json', 'SHA256SUMS'}


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def members(archive):
    result = {}
    for item in archive.getmembers():
        path = PurePosixPath(item.name)
        if path.is_absolute() or '..' in path.parts or item.name in result or not (item.isfile() or item.isdir()):
            raise ValueError('unsafe or duplicate archive entry: ' + item.name)
        if item.isfile():
            result[item.name] = archive.extractfile(item).read()
    return result


def image_metadata(data, sha):
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        return layout_metadata(members(archive), sha)


def layout_metadata(blobs, sha):
    if json.loads(blobs['oci-layout']) != {'imageLayoutVersion': '1.0.0'}:
        raise ValueError('invalid OCI layout version')
    def blob(descriptor):
        value = descriptor['digest']
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', value):
            raise ValueError('unsupported OCI digest')
        content = blobs['blobs/sha256/' + value[7:]]
        if digest(content) != value[7:] or len(content) != descriptor['size']:
            raise ValueError('OCI content digest/size mismatch')
        return content
    index = json.loads(blobs['index.json'])
    if index.get('schemaVersion') != 2 or len(index['manifests']) != 1:
        raise ValueError('expected one amd64 image')
    descriptor = index['manifests'][0]
    manifest = json.loads(blob(descriptor))
    if manifest.get('schemaVersion') != 2:
        raise ValueError('invalid OCI manifest schema')
    config = json.loads(blob(manifest['config']))
    for layer in manifest['layers']:
        blob(layer)
    labels = config['config']['Labels']
    if not re.fullmatch(r'[0-9a-f]{64}', labels['org.operatoros.source.tree-sha256']):
        raise ValueError('invalid image source manifest hash')
    if (config['architecture'], config['os']) != ('amd64', 'linux') or labels['org.opencontainers.image.revision'] != sha or labels['org.operatoros.source.dirty'] != 'false':
        raise ValueError('API image source/platform mismatch')
    return {'manifest_digest': descriptor['digest'], 'image_id': manifest['config']['digest'], 'source_tree_sha256': labels['org.operatoros.source.tree-sha256'], 'platform': 'linux/amd64'}



def logged(command, path, **kwargs):
    with open(path, 'w') as output:
        result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, **kwargs)
    print(Path(path).read_text(errors='replace'), flush=True)
    result.check_returncode()


def security_reports(reports, expected_image):
    scan = json.loads((reports / 'scan.json').read_bytes())
    sbom = json.loads((reports / 'sbom.cdx.json').read_bytes())
    if not isinstance(scan.get('Results'), list) or scan.get('Metadata', {}).get('ImageID') != expected_image['image_id']:
        raise ValueError('scan report image identity/results mismatch')
    properties = sbom.get('metadata', {}).get('component', {}).get('properties', [])
    image_ids = [p.get('value') for p in properties if p.get('name') == 'aquasecurity:trivy:ImageID']
    if sbom.get('bomFormat') != 'CycloneDX' or not isinstance(sbom.get('components'), list) or image_ids != [expected_image['image_id']]:
        raise ValueError('invalid CycloneDX report')


def scan_image(archive_path, sha, layout, reports, engine):
    reports.mkdir(parents=True, exist_ok=True)
    try:
        data = archive_path.read_bytes()
        metadata = {'archive_sha256': digest(data), 'archive_size_bytes': len(data), 'source_commit': sha, 'scanner': SCANNER}
        (reports / 'archive.json').write_text(json.dumps(metadata, indent=2) + '\n')
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            blobs = members(archive)
        expected_image = layout_metadata(blobs, sha)
        layout.mkdir()
        for name, content in blobs.items():
            if name not in ('index.json', 'oci-layout') and not re.fullmatch(r'blobs/sha256/[0-9a-f]{64}', name):
                raise ValueError('unexpected OCI layout member: ' + name)
            target = layout / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(content)
        # Scan only the validated, read-only layout; both reports use these exact blobs.
        metadata['image'] = expected_image
        (reports / 'archive.json').write_text(json.dumps(metadata, indent=2) + '\n')
        logged([engine, 'run', '--rm', SCANNER, '--version'], reports / 'trivy-version.txt')
        for fmt, filename in [('json', 'scan.json'), ('cyclonedx', 'sbom.cdx.json')]:
            logged([engine, 'run', '--rm', '-v', str(layout) + ':/image:ro', '-v', str(reports) + ':/reports', SCANNER, 'image', '--input', '/image', '--scanners', 'vuln', '--format', fmt, '--output', '/reports/' + filename], reports / (filename + '.log'))
        security_reports(reports, expected_image)
        extracted = {name: (layout / name).read_bytes() for name in blobs}
        if extracted != blobs or digest(archive_path.read_bytes()) != metadata['archive_sha256']:
            raise ValueError('scan input changed during scanning')
        return expected_image
    except Exception as error:
        (reports / 'scan-error.txt').write_text(str(error) + '\n')
        raise


def validate(files, sha):
    if set(files) != FILES:
        raise ValueError('incomplete or unexpected bundle files')
    expected = ''.join(f'{digest(files[name])}  {name}\n' for name in sorted(FILES - {'SHA256SUMS'}))
    if files['SHA256SUMS'].decode() != expected:
        raise ValueError('bundle checksum mismatch')
    manifest = json.loads(files['manifest.json'])
    if manifest.get('schema_version') != 1 or set(manifest['lockfiles']) != {'bun.lock', 'mise.lock'} or any(not re.fullmatch(r'[0-9a-f]{64}', value) for value in manifest['lockfiles'].values()):
        raise ValueError('invalid release schema/lockfile identity')
    if set(manifest['artifacts']) != FILES - {'manifest.json', 'SHA256SUMS'}:
        raise ValueError('manifest artifact inventory mismatch')
    if manifest['source_commit'] != sha or manifest['repository'] != REPO or manifest['workflow'] != WORKFLOW or manifest['source_ref'] != 'refs/heads/main':
        raise ValueError('manifest identity mismatch')
    if not re.fullmatch(r'[1-9][0-9]*', str(manifest['run_id'])) or not re.fullmatch(r'[1-9][0-9]*', str(manifest['run_attempt'])):
        raise ValueError('invalid workflow run identity')
    if manifest['image'] != image_metadata(files['operatoros-api.oci.tar'], sha):
        raise ValueError('image metadata mismatch')
    for name in FILES - {'SHA256SUMS', 'manifest.json'}:
        if manifest['artifacts'][name] != digest(files[name]):
            raise ValueError('manifest artifact mismatch')
    with tarfile.open(fileobj=io.BytesIO(files['operatoros-web-client.tar.gz'])) as archive:
        client = members(archive)
    if 'client/_shell.html' not in client or not any(name.startswith('client/assets/') for name in client):
        raise ValueError('missing static SPA output')
    if any(not name.startswith('client/') or any(p.startswith('.') for p in PurePosixPath(name).parts) for name in client):
        raise ValueError('unexpected SPA contents')
    if json.loads(client['client/release.json']) != {'source_commit': sha}:
        raise ValueError('SPA source mismatch')
    if json.loads(files['sbom.cdx.json']).get('bomFormat') != 'CycloneDX' or 'Results' not in json.loads(files['scan.json']):
        raise ValueError('invalid security evidence')
    return manifest


def pack(path, files, epoch):
    with open(path, 'wb') as output:
        compressed = str(path).endswith('.gz')
        stream = gzip.GzipFile(filename='', fileobj=output, mode='wb', mtime=epoch) if compressed else output
        try:
            with tarfile.open(fileobj=stream, mode='w') as archive:
                for name, data in sorted(files.items()):
                    entry = tarfile.TarInfo(name)
                    entry.size, entry.mtime, entry.mode = len(data), epoch, 0o644
                    archive.addfile(entry, io.BytesIO(data))
        finally:
            if compressed:
                stream.close()


def build(output, engine):
    sha = run('git', 'rev-parse', 'HEAD')
    if os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch' or os.environ.get('GITHUB_REF') != 'refs/heads/main' or os.environ.get('GITHUB_REPOSITORY') != REPO or os.environ.get('GITHUB_SHA') != sha:
        raise ValueError('release build requires trusted manual main workflow')
    run('bun', 'scripts/podman-source-manifest.mjs', 'assert-clean', '.')
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    diagnostics = output.parent / 'release-diagnostics'
    diagnostics.mkdir(exist_ok=True)
    try:
        tools = {tool: run(tool, '--version') for tool in ('bun', 'node', 'mise', engine)}
        (diagnostics / 'context.json').write_text(json.dumps({'source_commit': sha, 'tools': tools, 'scanner': SCANNER}, indent=2) + '\n')
        build_artifacts(output, engine, sha, diagnostics, tools)
    except Exception as error:
        (diagnostics / 'build-error.txt').write_text(str(error) + '\n')
        raise


def build_artifacts(output, engine, sha, diagnostics, tools):
    with tempfile.TemporaryDirectory(prefix='operatoros-release-') as temp:
        work = Path(temp)
        run('bun', 'scripts/podman-source-manifest.mjs', 'write-manifest', '.', str(work / 'source.json'))
        source_hash = digest((work / 'source.json').read_bytes())
        env = dict(os.environ, OPERATOROS_DISABLE_ENV_FILES='true', VITE_API_BASE_URL='', TZ='UTC')
        logged(['bun', 'run', 'build'], diagnostics / 'spa-build.log', cwd='apps/web', env=env)
        run('git', 'diff', '--exit-code', '--', 'apps/web/src/routeTree.gen.ts')
        run('bun', 'scripts/podman-source-manifest.mjs', 'assert-clean', '.')
        epoch = int(run('git', 'show', '-s', '--format=%ct', 'HEAD'))
        client = Path('apps/web/build/client')
        allowed = {'_shell.html', 'index.html', 'desktop-failure.css', 'desktop-failure.js', 'assets', '.vite'}
        if any(p.name not in allowed for p in client.iterdir()):
            raise ValueError('unexpected client build output')
        spa = {'client/' + p.relative_to(client).as_posix(): p.read_bytes() for p in client.rglob('*') if p.is_file() and '.vite' not in p.relative_to(client).parts}
        spa['client/release.json'] = json.dumps({'source_commit': sha}).encode()
        pack(work / 'operatoros-web-client.tar.gz', spa, epoch)
        image = 'operatoros-api:release-' + sha
        command = [engine, 'build', '--platform', 'linux/amd64', '-f', 'deploy/podman/Containerfile.api', '--build-arg', 'VCS_REF=' + sha, '--build-arg', 'SOURCE_TREE_SHA256=' + source_hash, '--build-arg', 'SOURCE_DIRTY=false', '-t', image, '.']
        if engine == 'podman':
            command[2:2] = ['--ignorefile', 'deploy/podman/.containerignore']
        logged(command, diagnostics / 'api-build.log')
        logged([engine, 'save', '--format', 'oci-archive', '-o', str(work / 'operatoros-api.oci.tar'), image], diagnostics / 'oci-export.log')
        scan_image(work / 'operatoros-api.oci.tar', sha, work / 'oci-layout', diagnostics, engine)
        for filename in ('scan.json', 'sbom.cdx.json'):
            (work / filename).write_bytes((diagnostics / filename).read_bytes())
        files = {name: (work / name).read_bytes() for name in FILES - {'manifest.json', 'SHA256SUMS'}}
        manifest = {'schema_version': 1, 'repository': REPO, 'source_commit': sha, 'source_ref': 'refs/heads/main', 'workflow': WORKFLOW, 'run_id': os.environ['GITHUB_RUN_ID'], 'run_attempt': os.environ['GITHUB_RUN_ATTEMPT'], 'tools': tools, 'lockfiles': {name: digest(Path(name).read_bytes()) for name in ('bun.lock', 'mise.lock')}, 'scanner': SCANNER, 'image': image_metadata(files['operatoros-api.oci.tar'], sha), 'artifacts': {name: digest(data) for name, data in files.items()}, 'security_scope': 'Trivy inventory; embedded Bun SQLite requires separate assessment'}
        files['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
        files['SHA256SUMS'] = ''.join(f'{digest(files[name])}  {name}\n' for name in sorted(files)).encode()
        validate(files, sha)
        pack(output, files, epoch)
        output.with_suffix(output.suffix + '.sha256').write_text(digest(output.read_bytes()) + '  ' + output.name + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    builder = sub.add_parser('build')
    builder.add_argument('output')
    verifier = sub.add_parser('verify')
    verifier.add_argument('bundle')
    verifier.add_argument('source_sha')
    args = parser.parse_args()
    if args.action == 'build':
        build(args.output, 'podman')
    else:
        if not re.fullmatch(r'[0-9a-f]{40}', args.source_sha):
            raise ValueError('expected full source SHA')
        run('gh', 'attestation', 'verify', args.bundle, '--repo', REPO, '--signer-workflow', WORKFLOW, '--source-ref', 'refs/heads/main', '--source-digest', args.source_sha, '--signer-digest', args.source_sha, '--deny-self-hosted-runners')
        with tarfile.open(args.bundle) as archive:
            manifest = validate(members(archive), args.source_sha)
        print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, tarfile.TarError, subprocess.CalledProcessError) as error:
        raise SystemExit('Release bundle rejected: ' + str(error))
