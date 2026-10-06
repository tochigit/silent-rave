"""Extract a locally emitted function ZIP into its newly owned test directory."""
import pathlib
import sys
import zipfile

archive, target = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]).resolve()
if not target.name.startswith("silent-rave-step5c1-") or not target.is_dir():
    raise RuntimeError("Expected owned package-test directory")
with zipfile.ZipFile(archive) as package:
    for entry in package.infolist():
        destination = (target / entry.filename).resolve()
        if not destination.is_relative_to(target) or "\\" in entry.filename:
            raise RuntimeError("Unsafe function ZIP entry")
    package.extractall(target)
