"""Package only the built public preview files; never archive the repository."""
from pathlib import Path
import hashlib
import json
import shutil
import zipfile

root = Path(__file__).resolve().parent.parent
output = (root / 'out' / 'client-preview').resolve()
assert output == root / 'out' / 'client-preview'
manifest = json.loads((root / 'reports' / 'client-preview-build.json').read_text(encoding='utf-8'))
files = ['assets/preview.js', 'assets/preview.css', 'assets/poster.jpeg', '404.html', '_headers', 'robots.txt']
files += [f'{route}/index.html' if route else 'index.html' for route in manifest['routes']]
actual = sorted(p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file())
assert actual == sorted(files), 'Unexpected files in output; package refused'
assert hashlib.sha256((output / 'assets' / 'preview.js').read_bytes()).hexdigest() == manifest['bundleSha256']
assert hashlib.sha256((output / 'assets' / 'preview.css').read_bytes()).hexdigest() == manifest['cssSha256']
acceptance = json.loads((root / 'reports' / 'reference-design' / 'acceptance.json').read_text(encoding='utf-8'))
assert acceptance['result'] == 'PASS', 'Browser acceptance must pass before packaging'
assert acceptance['build']['bundleSha256'] == manifest['bundleSha256'], 'Browser result is for another bundle'
assert acceptance['build']['cssSha256'] == manifest['cssSha256'], 'Browser result is for another stylesheet'

desktop = Path.home() / 'Desktop'
folder = desktop / 'Silent Rave - Reference Preview'
archive = desktop / 'Silent Rave - Reference Preview.zip'
# Refuse to overwrite a pre-existing directory or archive from another task.
assert not folder.exists() and not archive.exists(), 'Preview deliverables already exist; preserve and review them first'
folder.mkdir()
for name in files:
    destination = folder / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(output / name, destination)
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as package:
    for name in files:
        package.write(folder / name, name)
with zipfile.ZipFile(archive) as package:
    assert sorted(package.namelist()) == sorted(files)
    assert package.testzip() is None
    for name in files:
        assert package.read(name) == (folder / name).read_bytes()
shutil.copyfile(root / 'preview' / 'UPLOAD_STEPS.md', desktop / 'Silent Rave - Reference preview upload steps.md')
report = {'folder': str(folder), 'zip': str(archive), 'files': len(files), 'zipBytes': archive.stat().st_size, 'zipSha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'browserResult': 'PASS'}
(root / 'reports' / 'reference-preview-package.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
