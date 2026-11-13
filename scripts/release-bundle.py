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
FILES = {'operatoros-api.oci.tar', 'operatoros-web-client.tar.gz', 'sbom.cdx.json', 'scan.json', 'embedded-runtime.json', 'manifest.json', 'SHA256SUMS'}


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


def reject_unresolved_high_critical_findings(scan):
    findings = []
    results = scan.get('Results')
    if not isinstance(results, list):
        raise ValueError('vulnerability scan results are malformed')
    for result in results:
        if not isinstance(result, dict):
            raise ValueError('vulnerability scan result is malformed')
        vulnerabilities = result.get('Vulnerabilities')
        if vulnerabilities is None:
            continue
        if not isinstance(vulnerabilities, list):
            raise ValueError('vulnerability scan findings are malformed')
        for vulnerability in vulnerabilities:
            if not isinstance(vulnerability, dict):
                raise ValueError('vulnerability scan finding is malformed')
            raw_severity = vulnerability.get('Severity')
            if not isinstance(raw_severity, str) or not raw_severity.strip():
                raise ValueError('vulnerability scan finding is malformed')
            severity = raw_severity.strip().upper()
            if severity in {'HIGH', 'CRITICAL'}:
                identifier = vulnerability.get('VulnerabilityID')
                if not isinstance(identifier, str) or not identifier:
                    raise ValueError('high/critical vulnerability is missing its identifier')
                findings.append(f'{severity} {identifier}')
    if findings:
        raise ValueError('Trivy scan contains unresolved HIGH/CRITICAL findings: ' + ', '.join(findings))


def security_reports(reports, expected_image):
    scan = json.loads((reports / 'scan.json').read_bytes())
    sbom = json.loads((reports / 'sbom.cdx.json').read_bytes())
    if scan.get('Metadata', {}).get('ImageID') != expected_image['image_id']:
        raise ValueError('scan report image identity/results mismatch')
    reject_unresolved_high_critical_findings(scan)
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
    runtime = json.loads(files['embedded-runtime.json'])
    if runtime.get('schema_version') != 2 or runtime.get('qualification_status') != 'PASS':
        raise ValueError('embedded runtime is not release-qualified')
    if runtime.get('source', {}).get('commit') != sha:
        raise ValueError('embedded runtime source identity mismatch')
    if runtime.get('artifact', {}).get('oci_manifest_digest') != manifest['image']['manifest_digest'] or runtime.get('artifact', {}).get('image_config_digest') != manifest['image']['image_id']:
        raise ValueError('embedded runtime OCI identity mismatch')
    if runtime.get('artifact', {}).get('oci_archive_sha256') != digest(files['operatoros-api.oci.tar']):
        raise ValueError('embedded runtime OCI archive checksum mismatch')
    runtime_identity = runtime.get('runtime', {})
    driver_version = runtime_identity.get('sqlite_driver_version', '')
    if not re.fullmatch(r'\d+\.\d+\.\d+', driver_version) or not re.fullmatch(r'[0-9a-f]{64}', runtime_identity.get('binary_sha256', '')):
        raise ValueError('Node/SQLite runtime identity is incomplete')
    if runtime_identity.get('name') != 'Node.js' or runtime_identity.get('sqlite_driver') != 'better-sqlite3' or runtime_identity.get('sqlite_distribution') != 'bundled-native-addon':
        raise ValueError('release runtime does not use the qualified better-sqlite3 native addon')
    if not isinstance(runtime_identity.get('origin'), str) or not re.search(r'@sha256:[0-9a-f]{64}$', runtime_identity['origin']):
        raise ValueError('Node.js runtime origin is not digest-pinned')
    if not re.fullmatch(r'[0-9a-f]{64}', runtime.get('source', {}).get('containerfile_sha256', '')) or not runtime.get('source', {}).get('pinned_base_images'):
        raise ValueError('embedded runtime build provenance is incomplete')
    sqlite_libraries = runtime_identity.get('sqlite_libraries')
    expected_providers = {'better-sqlite3', 'node:sqlite'}
    if not isinstance(sqlite_libraries, list) or len(sqlite_libraries) != len(expected_providers) or any(not isinstance(item, dict) for item in sqlite_libraries):
        raise ValueError('release bundle omits one or more SQLite runtime identities')
    if {item.get('provider') for item in sqlite_libraries} != expected_providers:
        raise ValueError('release bundle has missing, duplicated, or unexpected SQLite runtime providers')
    expected_distributions = {'better-sqlite3': 'bundled-native-addon', 'node:sqlite': 'statically-linked-node-builtin'}
    expected_statuses = {}
    for library in sqlite_libraries:
        provider = library['provider']
        version = library.get('version', '')
        if not re.fullmatch(r'\d+\.\d+\.\d+', version) or not isinstance(library.get('source_id'), str) or not library['source_id']:
            raise ValueError(f'SQLite identity is incomplete for {provider}')
        if library.get('distribution') != expected_distributions[provider]:
            raise ValueError(f'SQLite distribution is invalid for {provider}')
        if not all(isinstance(library.get(name), bool) for name in ('fts5_present', 'fts5_compile_option', 'fts5_feature_probe')):
            raise ValueError(f'SQLite FTS5 evidence is incomplete for {provider}')
        if library['fts5_present'] != (library['fts5_compile_option'] or library['fts5_feature_probe']) or (library['fts5_compile_option'] and not library['fts5_feature_probe']):
            raise ValueError(f'SQLite FTS5 evidence conflicts for {provider}')
        version_tuple = tuple(map(int, version.split('.')))
        expected_status = 'RESOLVED_BY_FIXED_VERSION' if version_tuple >= (3, 54, 0) else (
            'NOT_AFFECTED_FTS5_ABSENT' if not library['fts5_present'] else 'OPEN'
        )
        if library.get('cve_status') != expected_status:
            raise ValueError(f'SQLite CVE status is invalid for {provider}')
        if library['fts5_present'] and version_tuple < (3, 54, 0):
            raise ValueError(f'release bundle contains an unqualified SQLite FTS5 runtime in {provider}')
        expected_statuses[provider] = expected_status
    finding_status = 'OPEN' if 'OPEN' in expected_statuses.values() else (
        'RESOLVED_BY_FIXED_VERSION' if 'RESOLVED_BY_FIXED_VERSION' in expected_statuses.values() else 'NOT_AFFECTED_FTS5_ABSENT'
    )
    expected_components = [
        {'provider': item['provider'], 'version': item['version'], 'status': item['cve_status']}
        for item in sorted(sqlite_libraries, key=lambda value: value['provider'])
    ]
    if runtime.get('finding', {}).get('components') != expected_components or runtime.get('finding', {}).get('status') != finding_status:
        raise ValueError('runtime finding does not match the qualified SQLite components')
    if finding_status not in {'RESOLVED_BY_FIXED_VERSION', 'NOT_AFFECTED_FTS5_ABSENT'}:
        raise ValueError('release bundle contains an unresolved SQLite finding')
    sbom = json.loads(files['sbom.cdx.json'])
    if sbom.get('bomFormat') != 'CycloneDX' or not isinstance(sbom.get('components'), list):
        raise ValueError('invalid CycloneDX report')
    scan = json.loads(files['scan.json'])
    if scan.get('Metadata', {}).get('ImageID') != manifest['image']['image_id']:
        raise ValueError('vulnerability scan image identity mismatch')
    reject_unresolved_high_critical_findings(scan)
    trivy_image_ids = [p.get('value') for p in sbom.get('metadata', {}).get('component', {}).get('properties', []) if p.get('name') == 'aquasecurity:trivy:ImageID']
    if trivy_image_ids != [manifest['image']['image_id']]:
        raise ValueError('SBOM image identity mismatch')
    node = next((component for component in sbom['components'] if component.get('bom-ref', '').startswith('urn:operatoros:runtime:node:')), None)
    driver = next((component for component in (node or {}).get('components', []) if component.get('name') == 'better-sqlite3'), None)
    node_sqlite = next((component for component in (node or {}).get('components', []) if component.get('name') == 'SQLite' and any(prop.get('name') == 'operatoros:sqlite:provider' and prop.get('value') == 'node:sqlite' for prop in component.get('properties', []))), None)
    driver_sqlite = next((component for component in (driver or {}).get('components', []) if component.get('name') == 'SQLite' and any(prop.get('name') == 'operatoros:sqlite:provider' and prop.get('value') == 'better-sqlite3' for prop in component.get('properties', []))), None)
    if not node or not driver or not node_sqlite or not driver_sqlite or node.get('version') != runtime_identity.get('version') or driver.get('version') != driver_version:
        raise ValueError('SBOM omits one or more Node.js SQLite runtime relationships')
    if driver.get('purl') != 'pkg:npm/better-sqlite3@' + driver_version:
        raise ValueError('SBOM better-sqlite3 package identity mismatch')
    if node.get('hashes') != [{'alg': 'SHA-256', 'content': runtime_identity['binary_sha256']}]:
        raise ValueError('SBOM Node.js executable digest mismatch')
    sbom_sqlite = {'better-sqlite3': driver_sqlite, 'node:sqlite': node_sqlite}
    for library in sqlite_libraries:
        component = sbom_sqlite[library['provider']]
        properties = {item.get('name'): item.get('value') for item in component.get('properties', [])}
        if component.get('version') != library['version'] or properties.get('operatoros:component:distribution') != library['distribution'] or properties.get('operatoros:sqlite:source-id') != library['source_id'] or properties.get('operatoros:sqlite:fts5-present') != str(library['fts5_present']) or properties.get('operatoros:sqlite:fts5-compile-option') != str(library['fts5_compile_option']) or properties.get('operatoros:sqlite:fts5-feature-probe') != str(library['fts5_feature_probe']) or properties.get('operatoros:security:advisory-status') != library['cve_status']:
            raise ValueError(f'SBOM SQLite evidence mismatch for {library["provider"]}')
    metadata_properties = {item.get('name'): item.get('value') for item in sbom.get('metadata', {}).get('properties', [])}
    required_metadata = {
        'operatoros:source:commit': sha,
        'operatoros:artifact:oci-manifest-digest': manifest['image']['manifest_digest'],
        'operatoros:artifact:oci-archive-sha256': runtime['artifact']['oci_archive_sha256'],
        'operatoros:runtime:qualification': 'PASS',
    }
    if any(metadata_properties.get(name) != value for name, value in required_metadata.items()):
        raise ValueError('SBOM is not bound to the release source and artifact')
    dependencies = {item.get('ref'): item.get('dependsOn') for item in sbom.get('dependencies', [])}
    node_dependencies = [driver.get('bom-ref'), node_sqlite.get('bom-ref')]
    if dependencies.get(node.get('bom-ref')) != node_dependencies or dependencies.get(driver.get('bom-ref')) != [driver_sqlite.get('bom-ref')]:
        raise ValueError('SBOM does not record both Node.js SQLite runtime relationships')
    expected_cve_state = {'RESOLVED_BY_FIXED_VERSION': 'resolved', 'NOT_AFFECTED_FTS5_ABSENT': 'not_affected'}[runtime['finding']['status']]
    affected_refs = {component.get('bom-ref') for component in sbom_sqlite.values() if any(prop.get('name') == 'operatoros:sqlite:fts5-present' and prop.get('value') == 'True' for prop in component.get('properties', []))}
    cve_entries = [item for item in sbom.get('vulnerabilities', []) if item.get('id') == 'CVE-2026-119373']
    if len(cve_entries) != 1:
        raise ValueError('SBOM must contain exactly one SQLite security disposition')
    cve = cve_entries[0]
    cve_affected = cve.get('affects')
    if not isinstance(cve_affected, list) or any(not isinstance(item, dict) or not isinstance(item.get('ref'), str) for item in cve_affected):
        raise ValueError('SBOM SQLite security disposition is malformed')
    if cve.get('analysis', {}).get('state') != expected_cve_state or {item['ref'] for item in cve_affected} != affected_refs:
        raise ValueError('SBOM omits the SQLite security disposition')
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
        scanned_image = scan_image(work / 'operatoros-api.oci.tar', sha, work / 'oci-layout', diagnostics, engine)
        (diagnostics / 'image.json').write_text(json.dumps(scanned_image, indent=2) + '\n')
        runtime_gate = subprocess.run(
            ['python3', 'scripts/check-node-sqlite-runtime.py', image],
            capture_output=True, text=True, check=False, timeout=75,
        )
        (diagnostics / 'runtime-gate.json').write_text(runtime_gate.stdout + ('' if runtime_gate.stdout.endswith('\n') else '\n'))
        try:
            runtime_report = json.loads(runtime_gate.stdout)
        except json.JSONDecodeError as error:
            raise ValueError('embedded runtime gate returned invalid JSON') from error
        if runtime_gate.returncode == 0 and runtime_report.get('status') != 'PASS':
            raise ValueError('embedded runtime gate did not report PASS')
        if runtime_gate.returncode != 0 and runtime_report.get('status') != 'BLOCKED':
            raise ValueError('embedded runtime gate failed without a BLOCKED report')
        inventory = subprocess.run(
            [
                'python3', 'scripts/record-embedded-runtime.py',
                '--runtime', str(diagnostics / 'runtime-gate.json'),
                '--image', str(diagnostics / 'image.json'),
                '--archive', str(diagnostics / 'archive.json'),
                '--containerfile', 'deploy/podman/Containerfile.api',
                '--sbom', str(diagnostics / 'sbom.cdx.json'),
                '--output', str(diagnostics / 'embedded-runtime.json'),
            ],
            capture_output=True, text=True, check=False,
        )
        if inventory.returncode != 0:
            raise ValueError('embedded runtime evidence rejected: ' + inventory.stderr.strip())
        if runtime_gate.returncode != 0:
            raise ValueError('Node/SQLite driver qualification failed; release packaging is blocked')
        for filename in ('scan.json', 'sbom.cdx.json'):
            (work / filename).write_bytes((diagnostics / filename).read_bytes())
        (work / 'embedded-runtime.json').write_bytes((diagnostics / 'embedded-runtime.json').read_bytes())
        files = {name: (work / name).read_bytes() for name in FILES - {'manifest.json', 'SHA256SUMS'}}
        manifest = {'schema_version': 1, 'repository': REPO, 'source_commit': sha, 'source_ref': 'refs/heads/main', 'workflow': WORKFLOW, 'run_id': os.environ['GITHUB_RUN_ID'], 'run_attempt': os.environ['GITHUB_RUN_ATTEMPT'], 'tools': tools, 'lockfiles': {name: digest(Path(name).read_bytes()) for name in ('bun.lock', 'mise.lock')}, 'scanner': SCANNER, 'image': image_metadata(files['operatoros-api.oci.tar'], sha), 'artifacts': {name: digest(data) for name, data in files.items()}, 'security_scope': {'os_and_language_packages': 'Trivy inventory in scan.json and sbom.cdx.json', 'native_database_runtime': 'embedded-runtime.json and CycloneDX Node.js, node:sqlite, better-sqlite3, and both SQLite components', 'application_dependencies': 'Trivy CycloneDX inventory'}}
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
    evidence = sub.add_parser('verify-evidence')
    evidence.add_argument('bundle')
    evidence.add_argument('source_sha')
    args = parser.parse_args()
    if args.action == 'build':
        build(args.output, 'podman')
    elif args.action == 'verify':
        if not re.fullmatch(r'[0-9a-f]{40}', args.source_sha):
            raise ValueError('expected full source SHA')
        run('gh', 'attestation', 'verify', args.bundle, '--repo', REPO, '--signer-workflow', WORKFLOW, '--source-ref', 'refs/heads/main', '--source-digest', args.source_sha, '--signer-digest', args.source_sha, '--deny-self-hosted-runners')
        with tarfile.open(args.bundle) as archive:
            manifest = validate(members(archive), args.source_sha)
        print(json.dumps(manifest, indent=2))
    else:
        if not re.fullmatch(r'[0-9a-f]{40}', args.source_sha):
            raise ValueError('expected full source SHA')
        with tarfile.open(args.bundle) as archive:
            manifest = validate(members(archive), args.source_sha)
        print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, tarfile.TarError, subprocess.CalledProcessError) as error:
        raise SystemExit('Release bundle rejected: ' + str(error))
