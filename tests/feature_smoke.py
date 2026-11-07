"""Executable HTTP + real GAT/Lightning acceptance in protein-course, isolated store."""

import json
import sys
import tempfile
import wave
from pathlib import Path
from urllib.request import urlopen

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "src"))
sys.path.insert(0, str(root / "examples"))
from runboard import Run
from runboard.lightning import RunBoardLogger


def main():
    import lightning as L
    import torch
    from torch_geometric.loader import DataLoader
    from course_gat import InterfaceModel

    assert "mlflow" not in sys.modules and "fastapi" not in sys.modules
    server = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:7311"
    with Run(
        "功能验收",
        "曲线基线",
        {"seed": 42, "learning_rate": 0.001},
        server=server,
        group="baseline",
        labels=["验收", "GAT"],
        monitor_interval=1,
        record_environment=True,
    ) as run:
        run.note("监控软件功能验收，曲线为固定数值，不表示模型性能。")
        for step in range(8):
            run.log(
                {"val/loss": 0.8 / (step + 1), "train/loss": 0.7 / (step + 1)},
                step=step,
            )
        run.text("epoch=7 train/loss=0.0875")
        with run.capture_console():
            print("console capture verified")
        resource = run.system()
        run.histogram("residue-score", [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.9], bins=5)
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            binary = folder / "weights.bin"
            binary.write_bytes(bytes(range(256)))
            run.artifact(binary)
            table = folder / "metrics.csv"
            table.write_text("epoch,loss\n0,0.8\n1,0.4\n", encoding="utf-8")
            run.artifact(table)
            pdb = folder / "trace.pdb"
            pdb.write_text(
                "\n".join(
                    f"ATOM  {i:5d}  CA  ALA A{i:4d}    {i * 3.0:8.3f}{(i % 2) * 2.0:8.3f}{(i % 3) * 1.0:8.3f}  1.00 20.00           C"
                    for i in range(1, 9)
                )
                + "\nEND\n",
                encoding="utf-8",
            )
            run.artifact(pdb)
            wav = folder / "sample.wav"
            with wave.open(str(wav), "wb") as sound:
                sound.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
                sound.writeframes(b"\x00\x00" * 800)
            run.artifact(wav)
    with Run(run_id=run.id, server=server) as resumed:
        assert resumed.next_step == 8
        resumed.log({"val/loss": 0.08, "train/loss": 0.07})
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
                {"val/loss": 0.7 / (step + 1), "train/loss": 0.6 / (step + 1)},
                step=step,
            )
    torch.set_num_threads(2)
    L.seed_everything(42)
    data = (
        root.parent / "external/protein_geometric_learning_course/data/20261105_pilot20"
    )
    names = json.loads((data / "splits.json").read_text(encoding="utf-8"))["train"][:4]
    graphs = [
        torch.load(data / "processed" / f"{name}.pt", weights_only=False)
        for name in names
    ]
    logger = RunBoardLogger(
        project="功能验收",
        name="GATv2 两步更新",
        server=server,
        group="real-graph",
        labels=["验收", "真实图"],
        monitor_interval=1,
        record_environment=True,
    )
    logger.experiment.note(
        "固定训练划分前四条真实课程图，CPU两次优化器更新，仅验收软件接入。"
    )
    trainer = L.Trainer(
        max_steps=2,
        accelerator="cpu",
        logger=logger,
        enable_checkpointing=False,
        log_every_n_steps=1,
        enable_progress_bar=False,
        enable_model_summary=False,
    )
    with logger.experiment.capture_console():
        trainer.fit(InterfaceModel(), DataLoader(graphs, batch_size=2, shuffle=False))
    assert "mlflow" not in sys.modules and "fastapi" not in sys.modules
    records = json.load(urlopen(server + "/api/runs"))
    assert any(
        record["id"] == run.id and record["status"] == "FINISHED" for record in records
    )
    history = json.load(
        urlopen(server + f"/api/runs/{run.id}/history?metric=val%2Floss")
    )
    assert [point["step"] for point in history] == list(range(9))
    assert urlopen(
        server + f"/api/runs/{run.id}/download?path=weights.bin"
    ).read() == bytes(range(256))
    result = {
        "passed": True,
        "server": server,
        "baseline": run.id,
        "candidate": candidate.id,
        "lightning": logger.version,
        "real_graphs": names,
        "optimizer_updates": 2,
        "gpu_devices": resource["gpus"],
        "gpu_status": resource["gpu_status"],
        "resource_keys": list(resource["metrics"]),
        "resume_steps": 9,
        "service_dependencies_imported": False,
    }
    output = root / "tests/browser-output"
    output.mkdir(parents=True, exist_ok=True)
    (output / "sdk-verification.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
