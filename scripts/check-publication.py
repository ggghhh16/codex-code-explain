"""Scan exactly the Git index and built VSIX; never print matching secret values."""
import json
import re
import subprocess
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parent.parent
git = ["git", "-c", f"safe.directory={root.as_posix()}"]
files = subprocess.check_output([*git, "ls-files", "-z"], cwd=root).decode().split("\0")
patterns = {
    "credential-like token": re.compile(r"\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,})\b"),
    "local owner directory": re.compile(r"(?i)(?:[A-Z]:[/\\]+Users[/\\]+G(?:[/\\]|\b)|D:[/\\]+CodingExp)"),
    "private email": re.compile(r"\b\d{6,}@qq\.com\b"),
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----\s*\n[^-]+\n-----END"),
}
issues = []
for name in filter(None, files):
    if name.startswith(("artifacts/", ".protocol/", ".publish/")) or name.endswith((".vsix", ".log")):
        issues.append((name, "excluded artifact staged"))
    content = subprocess.check_output([*git, "show", f":{name}"], cwd=root).decode("utf-8")
    for label, pattern in patterns.items():
        if pattern.search(content):
            issues.append((name, label))

manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
archive = root / f"{manifest['name']}-{manifest['version']}.vsix"
with ZipFile(archive) as package:
    for name in package.namelist():
        if name.startswith(("extension/artifacts/", "extension/test/", "extension/.protocol/", "extension/.git/")):
            issues.append((name, "unexpected package entry"))
        content = package.read(name).decode("utf-8")
        for label, pattern in patterns.items():
            if pattern.search(content):
                issues.append((name, label))
if issues:
    print(json.dumps({"status": "FAIL", "findings": issues}, ensure_ascii=False))
    raise SystemExit(1)
print(json.dumps({"status": "PASS", "tracked_files": len(list(filter(None, files))), "vsix": archive.name, "scope": "staged text files and all package entries"}))
