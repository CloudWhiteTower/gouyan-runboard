import io
from types import SimpleNamespace

from fastapi.testclient import TestClient

from runboard import Run
from runboard.api import create_app
from runboard.console import ConsoleStream


def test_batch_histories_matches_single_queries(tmp_path):
    with Run("batch", "baseline", home=tmp_path) as first:
        first.log({"loss": 0.4, "score": 0.7}, step=2)
        first.log({"loss": 0.3, "score": 0.8}, step=3)
    with Run("batch", "candidate", home=tmp_path) as second:
        second.log({"loss": 0.2}, step=5)
    client = TestClient(create_app(tmp_path))
    result = client.post(
        "/api/histories",
        json={"run_ids": [first.id, second.id], "metrics": ["loss", "score"]},
    )
    assert result.status_code == 200
    for key in ("loss", "score"):
        for rid in (first.id, second.id):
            assert (
                result.json()[key][rid]
                == client.get(f"/api/runs/{rid}/history", params={"metric": key}).json()
            )
    assert result.json()["score"][second.id] == []
    assert (
        client.post(
            "/api/histories", json={"run_ids": [first.id] * 7, "metrics": ["loss"]}
        ).status_code
        == 422
    )


def test_system_response_uses_existing_cpu_sample(tmp_path, monkeypatch):
    from runboard.telemetry import Sampler

    monkeypatch.setattr(
        Sampler, "collect", lambda self: {"system/host_cpu_percent": 37.5}
    )
    client = TestClient(create_app(tmp_path))
    assert client.get("/api/system").json()["cpu_percent"] == 37.5


def test_console_tail_preserves_long_unicode_lines():
    rows = []
    run = SimpleNamespace(text=lambda text, stream: rows.append(text))
    stream = ConsoleStream(run, io.StringIO(), "stdout")
    message = "残基" * 33000
    stream.write(message)
    stream.emit(stream.pending)
    assert "".join(rows) == message and all(len(row) <= 64000 for row in rows)
    assert stream.writable()
