"""Build a self-contained wheel from a clean sdist, including the web UI."""

import shutil
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
npm = shutil.which("npm")
if not npm:
    raise SystemExit("Building from source requires Node.js 22+ and npm.")

subprocess.run([npm, "ci"], cwd=root / "frontend", check=True)
subprocess.run([npm, "run", "build"], cwd=root / "frontend", check=True)
subprocess.run([sys.executable, "scripts/collect_licenses.py"], cwd=root, check=True)
subprocess.run([sys.executable, "-m", "build", "--sdist"], cwd=root, check=True)
# Building through the sdist prevents old build/lib assets entering a new wheel.
import tomllib

version = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))[
    "project"
]["version"]
source = root / "dist" / f"gouyan_runboard-{version}.tar.gz"
subprocess.run(
    [
        sys.executable,
        "-m",
        "pip",
        "wheel",
        "--no-deps",
        "--wheel-dir",
        "dist",
        str(source),
    ],
    cwd=root,
    check=True,
)
