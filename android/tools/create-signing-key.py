"""Create a durable Android signing key and private GitHub Secret input files."""
import argparse
import base64
import hashlib
import os
from pathlib import Path
import secrets
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir', required=True)
args = parser.parse_args()
folder = Path(args.output_dir).resolve()
folder.mkdir(parents=True, exist_ok=True, mode=0o700)
paths = [folder / name for name in ('wordpop.p12', 'keystore-base64.txt', 'keystore-password.txt', 'certificate.sha256')]
if any(path.exists() for path in paths):
    raise SystemExit('Refusing to overwrite existing signing material.')
keytool = str(Path(os.environ['JAVA_HOME']) / 'bin/keytool') if os.environ.get('JAVA_HOME') else shutil.which('keytool')
if not keytool:
    raise SystemExit('Install a JDK and set JAVA_HOME first.')
env = {**os.environ, 'WORDPOP_KEY_PASSWORD': secrets.token_urlsafe(36)}
common = [keytool, '-keystore', str(paths[0]), '-storepass:env', 'WORDPOP_KEY_PASSWORD', '-alias', 'wordpop']
subprocess.run(common + ['-genkeypair', '-keypass:env', 'WORDPOP_KEY_PASSWORD', '-storetype', 'PKCS12',
    '-keyalg', 'RSA', '-keysize', '3072', '-sigalg', 'SHA256withRSA', '-validity', '10000',
    '-dname', 'CN=WordPop, O=WordPop', '-noprompt'], env=env, check=True)
paths[0].chmod(0o600)
certificate = subprocess.run(common + ['-exportcert'], env=env, check=True, capture_output=True).stdout
values = [base64.b64encode(paths[0].read_bytes()).decode(), env['WORDPOP_KEY_PASSWORD'], hashlib.sha256(certificate).hexdigest() + '\n']
for path, value in zip(paths[1:], values):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as out:
        out.write(value)
print('Created private signing files in:', folder)
print('Public certificate SHA-256:', hashlib.sha256(certificate).hexdigest())
print('Back up the keystore and password. Do not commit or share private files.')
