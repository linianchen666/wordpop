"""Verify an APK signature against the repository's pinned public certificate."""
import argparse
import os
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apk', required=True)
parser.add_argument('--apksigner', required=True)
parser.add_argument('--expected', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
expected = Path(args.expected).read_text().strip().lower()
if not re.fullmatch('[0-9a-f]{64}', expected):
    raise SystemExit('Invalid expected signing certificate fingerprint.')
result = subprocess.run([args.apksigner, 'verify', '--print-certs', args.apk], check=True, capture_output=True, text=True)
signers = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)', result.stdout)
if signers != [expected]:
    raise SystemExit('APK signing certificate differs from pinned WordPop certificate. Do not publish.')
Path(args.output).write_text(expected + '\n')
print('APK signature verified against pinned certificate:', expected)
