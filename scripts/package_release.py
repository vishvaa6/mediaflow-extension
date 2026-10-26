"""Create a browser-ready ZIP containing only the extension runtime and docs."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
version = manifest["version"]
output = root / "dist"
output.mkdir(exist_ok=True)
archive = output / f"mediaflow-extension-v{version}.zip"
files = [root / name for name in ("manifest.json", "README.md", "RELEASE_NOTES.md")]
files.extend(root.glob("icon-*.png"))
for directory in ("_locales", "assets", "js", "src"):
    files.extend(path for path in (root / directory).rglob("*") if path.is_file())
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
    for path in sorted(set(files)):
        if path.is_symlink():
            raise RuntimeError(f"Refusing symlink: {path}")
        bundle.write(path, path.relative_to(root).as_posix())
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert json.loads(bundle.read("manifest.json"))["version"] == version
    assert "manifest.json" in bundle.namelist()
    assert not any(name.startswith(("tests/", "test-results/", "graphify-out/", ".git/")) for name in bundle.namelist())
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
checksum = output / "SHA256SUMS.txt"
checksum.write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
print(f"Created {archive.name}: {len(files)} files, {archive.stat().st_size:,} bytes")
print(f"SHA-256: {digest}")
