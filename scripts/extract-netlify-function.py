"""Extract a locally emitted function ZIP into its newly owned test directory."""
import pathlib
import sys
import zipfile
import stat
import shutil

archive, target = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]).resolve()
if not target.name.startswith("silent-rave-step5c1-") or not target.is_dir():
    raise RuntimeError("Expected owned package-test directory")
with zipfile.ZipFile(archive) as package:
    links = []
    for entry in package.infolist():
        destination = (target / entry.filename).resolve()
        if not destination.is_relative_to(target) or "\\" in entry.filename:
            raise RuntimeError("Unsafe function ZIP entry")
        if stat.S_ISLNK(entry.external_attr >> 16):
            raw = package.read(entry).decode('utf-8').replace('\\', '/')
            source = (destination.parent / raw).resolve()
            if not source.is_relative_to(target) and source.is_relative_to(archive.resolve().parents[2]) and '/node_modules/' in raw:
                # Windows standalone aliases may record an absolute build path.
                # Resolve only the corresponding files already inside this ZIP.
                source = (target / 'node_modules' / raw.split('/node_modules/', 1)[1]).resolve()
            if not source.is_relative_to(target):
                raise RuntimeError(f"Unsafe function ZIP link: {entry.filename} -> {raw}")
            links.append((destination, source))
        else:
            package.extract(entry, target)
    # ZIP stores dependency aliases as Unix links. Materialize their contents on
    # both systems; Windows must not require Developer Mode or symlink privilege.
    while links:
        deferred = []
        for destination, source in links:
            if not source.exists():
                deferred.append((destination, source))
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(source, destination)
            else:
                shutil.copy2(source, destination)
        if len(deferred) == len(links):
            raise RuntimeError("Unresolved function ZIP links")
        links = deferred
