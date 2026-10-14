"""Check that repository signing secrets unlock the pinned private signing key."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--keystore', required=True)
parser.add_argument('--expected', required=True)
args = parser.parse_args()
if not os.environ.get('WORDPOP_ANDROID_KEYSTORE_PASSWORD'):
    raise SystemExit('Missing WORDPOP_ANDROID_KEYSTORE_PASSWORD in repository Actions Secrets.')
expected = Path(args.expected).read_text().strip().lower()
if not re.fullmatch('[0-9a-f]{64}', expected):
    raise SystemExit('Invalid pinned signing certificate fingerprint.')
keytool = str(Path(os.environ['JAVA_HOME']) / 'bin/keytool') if os.environ.get('JAVA_HOME') else shutil.which('keytool')
if not keytool:
    raise SystemExit('JDK keytool is unavailable.')
# Importing the private entry proves the key password works, beyond reading its certificate.
with tempfile.TemporaryDirectory(prefix='wordpop-key-check-') as folder:
    copy = Path(folder) / 'verified.p12'
    imported = subprocess.run([keytool, '-importkeystore', '-srckeystore', args.keystore,
        '-srcstoretype', 'PKCS12', '-srcalias', 'wordpop',
        '-srcstorepass:env', 'WORDPOP_ANDROID_KEYSTORE_PASSWORD', '-srckeypass:env', 'WORDPOP_ANDROID_KEYSTORE_PASSWORD',
        '-destkeystore', str(copy), '-deststoretype', 'PKCS12', '-destalias', 'wordpop',
        '-deststorepass:env', 'WORDPOP_ANDROID_KEYSTORE_PASSWORD', '-destkeypass:env', 'WORDPOP_ANDROID_KEYSTORE_PASSWORD', '-noprompt'],
        capture_output=True)
    if imported.returncode:
        raise SystemExit('Cannot unlock signing key. Check the saved keystore, password and wordpop alias; secret contents are hidden.')
    copy.chmod(0o600)
    exported = subprocess.run([keytool, '-exportcert', '-keystore', str(copy), '-alias', 'wordpop',
        '-storepass:env', 'WORDPOP_ANDROID_KEYSTORE_PASSWORD'], capture_output=True)
    if exported.returncode:
        raise SystemExit('Cannot read the signing certificate; secret contents are hidden.')
    actual = hashlib.sha256(exported.stdout).hexdigest()
    if actual != expected:
        raise SystemExit('Saved signing key differs from the pinned WordPop certificate. Do not publish.')
print('Signing secrets verified: private key unlocks and certificate matches the pinned WordPop fingerprint.')
