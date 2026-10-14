"""Restore a signing key from a GitHub Secret without logging its contents."""
import argparse
import base64
import os
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', required=True)
args = parser.parse_args()
value = os.environ.get('WORDPOP_ANDROID_KEYSTORE_BASE64', '')
if not value:
    raise SystemExit('Missing WORDPOP_ANDROID_KEYSTORE_BASE64. Configure repository Actions Secrets; random debug signing is disabled in CI.')
try:
    content = base64.b64decode(''.join(value.split()), validate=True)
except ValueError:
    raise SystemExit('WORDPOP_ANDROID_KEYSTORE_BASE64 is not valid base64.')
if not content:
    raise SystemExit('Signing key is empty.')
path = Path(args.output).resolve()
path.parent.mkdir(parents=True, exist_ok=True)
with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as out:
    out.write(content)
print('Signing key restored (contents hidden).')
