#!/usr/bin/env python3
"""Exercise the pinned scanner on a synthetic OCI archive, never a release bundle."""
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

from test_release_bundle import fixture, m, SHA


def check(output):
    output.mkdir(parents=True, exist_ok=True)
    # A separate rootless store prevents test pulls/removals from touching host containers.
    (output / 'storage.conf').write_text('[storage]\ndriver="vfs"\ngraphroot="' + str(output / 'graphroot') + '"\nrunroot="' + str(output / 'runroot') + '"\n')
    os.environ['CONTAINERS_STORAGE_CONF'] = str(output / 'storage.conf')
    archive = output / 'synthetic.oci.tar'
    archive.write_bytes(fixture()['operatoros-api.oci.tar'])
    with (output / 'before.log').open('w') as log:
        before = subprocess.run(['podman', 'run', '--rm', '-v', str(archive) + ':/image.tar:ro', m.SCANNER, 'image', '--input', '/image.tar', '--scanners', 'vuln', '--format', 'json'], stdout=log, stderr=subprocess.STDOUT)
    baseline_error = (output / 'before.log').read_text()
    if before.returncode == 0 or 'file manifest.json not found in tar' not in baseline_error or 'not a directory' not in baseline_error:
        raise ValueError('baseline archive mismatch was not reproduced')
    image = m.scan_image(archive, SHA, output / 'layout', output / 'reports', 'podman')
    corrupt = output / 'corrupt.oci.tar'
    corrupt.write_bytes(b'intentionally invalid OCI archive')
    try:
        m.scan_image(corrupt, SHA, output / 'bad-layout', output / 'bad-reports', 'podman')
    except tarfile.TarError:
        if not (output / 'bad-reports' / 'scan-error.txt').exists():
            raise ValueError('missing corrupt archive diagnostics')
    else:
        raise ValueError('corrupt archive was accepted')
    result = {'scanner': m.SCANNER, 'version': (output / 'reports' / 'trivy-version.txt').read_text().strip(), 'archive_input_exit': before.returncode, 'layout_scan': 'PASS', 'json_and_cyclonedx_identity': image, 'corrupt_archive': 'REJECTED', 'scan_failure_diagnostics': 'PRESENT'}
    (output / 'compatibility.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    path = Path(os.environ.get('SCANNER_TEST_OUTPUT') or tempfile.mkdtemp(prefix='operatoros-scanner-test-')).resolve()
    check(path)
