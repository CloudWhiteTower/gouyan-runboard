import json
import subprocess
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from runboard import Run
from runboard.api import create_app
from runboard.telemetry import Sampler


def test_resume_keeps_history_and_rejects_changed_configuration(tmp_path):
    with Run(
        "实验",
        "基线",
        {"seed": 42},
        home=tmp_path,
        group="baseline",
        labels=["GAT", "GAT"],
        record_environment=True,
    ) as first:
        first.log({"loss": 0.7}, step=0)
        first.log({"loss": 0.4}, step=3)
    with Run(home=tmp_path, run_id=first.id, config={"seed": 42}) as resumed:
        assert resumed.next_step == 4
        assert (
            resumed.store.run_dict(resumed.store.client.get_run(resumed.id))["end_time"]
            is None
        )
        resumed.log({"loss": 0.3})
    assert [p["step"] for p in first.store.history(first.id, "loss")] == [0, 3, 4]
    record = first.store.client.get_run(first.id)
    assert record.data.tags["runboard.group"] == "baseline"
    assert json.loads(record.data.tags["runboard.labels"]) == ["GAT"]
    assert "python" in json.loads(record.data.tags["runboard.environment"])
    with pytest.raises(ValueError, match="已有参数不可改变"):
        Run(home=tmp_path, run_id=first.id, config={"seed": 43})
    assert first.store.client.get_run(first.id).info.status == "FINISHED"


def test_logs_are_queryable_and_credentials_redacted(tmp_path):
    with Run("实验", "日志", home=tmp_path) as run:
        run.text("epoch=1 loss=0.4", step=1)
        run.text(
            "password=demo-sentinel Authorization: Bearer demo-bearer-sentinel",
            stream="stderr",
        )
        with run.capture_console():
            print("epoch=2 loss=0.3")
    client = TestClient(create_app(tmp_path))
    rows = client.get(f"/api/runs/{run.id}/logs").json()
    assert len(rows) == 3
    assert "demo-sentinel" not in str(rows) and "demo-bearer-sentinel" not in str(rows)
    assert "[REDACTED]" in rows[1]["text"]
    result = client.get(f"/api/runs/{run.id}/logs?query=epoch%3D2").json()
    assert len(result) == 1 and result[0]["stream"] == "stdout"
    assert len(client.get(f"/api/runs/{run.id}/logs?after={rows[0]['id']}").json()) == 2


def test_console_does_not_persist_multiline_private_material(tmp_path, capsys):
    with Run("实验", "日志边界", home=tmp_path) as run:
        with run.capture_console():
            print("-----BEGIN TEST PRIVATE KEY-----")
            print("synthetic-private-material")
            print("-----END TEST PRIVATE KEY-----")
            print("training continues")
    rows = run.store.text_logs(run.id)
    assert "synthetic-private-material" not in str(rows)
    assert rows[-1]["text"] == "training continues"


def test_http_resume_metadata_statistics_and_media(tmp_path):
    client = TestClient(create_app(tmp_path))
    rid = client.post(
        "/api/track/runs",
        json={"project": "实验", "name": "HTTP", "config": {"seed": 42}},
    ).json()["id"]
    client.post(
        f"/api/track/runs/{rid}/metrics", json={"metrics": {"loss": 0.4}, "step": 7}
    )
    client.patch(
        f"/api/runs/{rid}",
        json={"status": "FINISHED", "group": "family-A", "labels": ["acid", "acid"]},
    )
    assert (
        client.post(f"/api/track/runs/{rid}/resume", json={"config": {}}).json()[
            "next_step"
        ]
        == 8
    )
    assert client.get(f"/api/runs/{rid}").json()["end_time"] is None
    assert json.loads(
        client.get(f"/api/runs/{rid}").json()["tags"]["runboard.labels"]
    ) == ["acid"]
    assert (
        client.patch(
            f"/api/runs/{rid}", json={"environment": {"password": "dummy"}}
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/track/runs/{rid}/resume", json={"config": {"seed": 43}}
        ).status_code
        == 422
    )
    summary = client.get(f"/api/runs/{rid}/statistics?metric=loss").json()
    assert summary["min"]["step"] == 7 and summary["count"] == 1
    content = b"epoch,loss\n1,0.4\n"
    assert (
        client.post(
            f"/api/track/runs/{rid}/artifact",
            files={"file": ("result.csv", content)},
            data={"folder": "evaluation"},
        ).status_code
        == 200
    )
    preview = client.get(
        f"/api/runs/{rid}/download?path=evaluation/result.csv&preview=true"
    ).json()
    assert preview["text"].encode() == content and not preview["truncated"]
    assert (
        client.get(f"/api/runs/{rid}/download?path=evaluation/result.csv").content
        == content
    )
    client.post(
        f"/api/track/runs/{rid}/artifact",
        files={"file": ("opaque.bin", b"\x00\xff\x10")},
    )
    assert (
        client.get(f"/api/runs/{rid}/download?path=opaque.bin").content
        == b"\x00\xff\x10"
    )
    assert (
        client.get(f"/api/runs/{rid}/download?path=opaque.bin&preview=true").status_code
        == 400
    )
    client.post(
        f"/api/track/runs/{rid}/artifact", files={"file": ("sample.wav", b"RIFF-test")}
    )
    assert (
        client.get(f"/api/runs/{rid}/download?path=sample.wav&inline=true").status_code
        == 200
    )


def test_gpu_sampling_does_not_invent_unsupported_metrics(monkeypatch):
    sampler = Sampler()
    sampler.nvidia = "test-nvidia-smi"
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0, stdout="0, Test GPU, 15, 128, 8192, 43, [N/A]\n"
        ),
    )
    values = sampler.collect()
    assert values["system/gpu/0/memory_used_mb"] == 128
    assert values["system/gpu/0/utilization_percent"] == 15
    assert "system/gpu/0/power_w" not in values
    assert sampler.devices == [{"index": "0", "name": "Test GPU"}]
    sampler.nvidia = None
    values = sampler.collect()
    assert not any(key.startswith("system/gpu/") for key in values)


def test_histogram_is_saved_as_portable_chart(tmp_path):
    with Run("实验", "分布", home=tmp_path) as run:
        run.histogram("residue-score", [0, 0.2, 0.5, 0.9, 1], bins=4, step=3)
    client = TestClient(create_app(tmp_path))
    content = client.get(
        f"/api/runs/{run.id}/download?path=charts/residue-score-3.json"
    ).json()
    assert (
        content["runboard_chart"] == 1
        and sum(content["option"]["series"][0]["data"]) == 5
    )
    with pytest.raises(ValueError):
        run.histogram("bad", [float("nan")])
