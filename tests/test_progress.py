import pytest
from fastapi.testclient import TestClient

from runboard import Run
from runboard.api import create_app
from runboard.http_store import HttpStore


def test_progress_and_parameters_across_runs(tmp_path, monkeypatch):
    client = TestClient(create_app(tmp_path))

    def request(self, path, body=None, method=None):
        response = client.request(
            method or ("POST" if body else "GET"), "/api" + path, json=body
        )
        response.raise_for_status()
        return response.json()

    monkeypatch.setattr(HttpStore, "request", request)
    first = Run("test", "baseline", {"total_epochs": 10, "learning_rate": 0.01})
    second = Run(
        "test", "candidate", {"training": {"max_epochs": 4}, "learning_rate": 0.02}
    )
    first.log({"val/loss": 0.5}, step=20)
    first.log_epoch(1, 40)
    first.log_epoch(2, 60)
    second.log_epoch(1, 100)
    second.finish("KILLED")

    def runs():
        return {row["id"]: row for row in client.get("/api/runs").json()}

    rows = runs()
    assert rows[first.id]["progress"] == {
        "completed": 2,
        "total": 10,
        "average_seconds": 50,
        "remaining_seconds": 400,
    }
    assert rows[second.id]["progress"] == {
        "completed": 1,
        "total": 4,
        "average_seconds": 100,
        "remaining_seconds": None,
    }
    assert [rows[r.id]["config"]["learning_rate"] for r in (first, second)] == [
        0.01,
        0.02,
    ]

    resumed = Run(run_id=first.id)
    assert resumed.next_step == 21
    resumed.log_epoch(1, 20)
    assert resumed.next_step == 21
    assert runs()[first.id]["progress"]["average_seconds"] == 40
    resumed.log_epoch(10, 60)
    assert runs()[first.id]["progress"]["remaining_seconds"] == 0

    for epoch, seconds in ((0, 10), (1.5, 10), (2, 0), (2, float("inf"))):
        with pytest.raises(ValueError):
            resumed.log_epoch(epoch, seconds)


def test_legacy_epoch_requires_completed_timing(tmp_path):
    run = Run("test", "legacy", {"config": {"epochs": 20}}, home=tmp_path)
    run.log({"epoch": 1, "epoch/minutes": 2}, step=100)
    run.log({"epoch": 2}, step=101)
    run.log({"epoch": 2, "epoch/minutes": 1}, step=200)
    run.log({"epoch": 3}, step=201)
    old = Run("test", "untimed", {"epochs": 30}, home=tmp_path)
    old.log({"epoch": 4, "val/loss": 0.5}, step=200)

    rows = {row["id"]: row for row in run.store.runs()}
    assert rows[run.id]["progress"] == {
        "completed": 2,
        "total": 20,
        "average_seconds": 90,
        "remaining_seconds": 1620,
    }
    assert rows[old.id]["progress"] == {
        "completed": None,
        "total": 30,
        "average_seconds": None,
        "remaining_seconds": None,
    }
