"""Prepare portable browser fixtures against an isolated local RunBoard service."""

import sys
import tempfile
import wave
from pathlib import Path

from runboard import Run

server = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:7311"
output = Path(__file__).resolve().parent / "browser-output"
output.mkdir(exist_ok=True)
(output / "browser-upload.bin").write_bytes(bytes([0, 1, 2, 255]))

with Run(
    "功能验收",
    "曲线基线",
    {"seed": 42, "learning_rate": 0.001},
    server=server,
    group="baseline",
    labels=["验收", "GAT"],
    record_environment=True,
) as baseline:
    baseline.note("浏览器功能验收数据，不代表模型性能。")
    for step in range(9):
        baseline.log(
            {
                "val/loss": 0.08 if step == 8 else 0.8 / (step + 1),
                "train/loss": 0.7 / (step + 1),
            },
            step=step,
        )
        if step in (0, 8):
            baseline.system(step)
    baseline.text("console capture verified")
    baseline.histogram("residue-score", [0.1, 0.2, 0.3, 0.4, 0.8], bins=5, step=7)
    with tempfile.TemporaryDirectory() as temp:
        folder = Path(temp)
        csv = folder / "metrics.csv"
        csv.write_text("epoch,loss\n0,0.8\n1,0.4\n", encoding="utf-8")
        baseline.artifact(csv)
        pdb = folder / "trace.pdb"
        pdb.write_text(
            "\n".join(
                f"ATOM  {i:5d}  CA  ALA A{i:4d}    {i * 3.0:8.3f}{(i % 2) * 2.0:8.3f}{(i % 3) * 1.0:8.3f}  1.00 20.00           C"
                for i in range(1, 9)
            )
            + "\nEND\n",
            encoding="utf-8",
        )
        baseline.artifact(pdb)
        audio = folder / "sample.wav"
        with wave.open(str(audio), "wb") as stream:
            stream.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
            stream.writeframes(b"\0\0" * 800)
        baseline.artifact(audio)
with Run(
    "功能验收",
    "曲线候选",
    {"seed": 42, "learning_rate": 0.002},
    server=server,
    group="candidate",
    labels=["验收", "GAT"],
) as candidate:
    for step in range(9):
        candidate.log(
            {"val/loss": 0.7 / (step + 1), "train/loss": 0.6 / (step + 1)}, step=step
        )
print("Browser fixtures ready.")
