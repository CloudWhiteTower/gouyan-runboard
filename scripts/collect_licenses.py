"""Collect notices for the frontend code bundled in the Python wheel."""

import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sections = []
for name in [
    "react",
    "react-dom",
    "scheduler",
    "echarts",
    "zrender",
    "tslib",
    "lucide-react",
]:
    folder = root / "frontend/node_modules" / name
    package = json.loads((folder / "package.json").read_text(encoding="utf-8"))
    licenses = [
        p
        for p in folder.iterdir()
        if p.is_file() and p.name.lower().startswith(("license", "notice", "copyright"))
    ]
    sections.append(
        f"\n{'=' * 72}\n{name} {package['version']}\nLicense: {package.get('license', 'See below')}\n"
    )
    for path in licenses:
        sections.append(path.name + "\n" + path.read_text(encoding="utf-8"))
destination = root / "src/runboard/web/THIRD_PARTY_LICENSES.txt"
destination.write_text("\n".join(sections), encoding="utf-8")
print("Collected bundled frontend notices:", len(sections), "sections")
