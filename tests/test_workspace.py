import json
import pytest
from fastapi.testclient import TestClient
from runboard import Run
from runboard.api import create_app
from runboard.store import clean_config
from runboard.importer import import_tensorboard
from runboard.sweeps import create_study, execute_study, list_studies


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path / "home", workspace=tmp_path))


def test_sdk_history_artifacts_and_metadata(client, tmp_path):
    home = client.app.state.store.home
    artifact = tmp_path / "model.json"
    artifact.write_text('{"weight": 1}', encoding="utf-8")
    with Run(
        "测试项目", "可重复的训练", {"learning_rate": 0.01, "seed": 42}, home=home
    ) as run:
        run.log({"val/loss": 0.8}, step=0)
        run.log({"val/loss": 0.3}, step=1)
        run.artifact(artifact, "models")
    rid = run.id
    item = client.get(f"/api/runs/{rid}").json()
    assert item["status"] == "FINISHED" and item["metrics"]["val/loss"] == 0.3
    assert item["config"]["seed"] == 42
    points = client.get(
        f"/api/runs/{rid}/history", params={"metric": "val/loss"}
    ).json()
    assert [p["value"] for p in points] == [0.8, 0.3]
    client.patch(f"/api/runs/{rid}", json={"note": "对照组", "pinned": True})
    assert (
        client.get(f"/api/runs/{rid}").json()["tags"]["mlflow.note.content"] == "对照组"
    )
    assert (
        client.get(f"/api/runs/{rid}/artifacts?path=models").json()[0]["path"]
        == "models/model.json"
    )
    file = client.get(f"/api/runs/{rid}/download?path=models/model.json")
    assert file.status_code == 200 and json.loads(file.content) == {"weight": 1}
    assert (
        client.get("/api/export", params={"ids": rid, "kind": "metrics"}).text.count(
            "val/loss"
        )
        == 2
    )
    assert client.get(f"/api/runs/{rid}/download?path=../model.json").status_code == 400


def test_templates_versions_and_local_boundary(client, tmp_path):
    assert client.get("/api/system").json()["disk_free_gb"] > 0
    payload = {"name": "基线", "project": "测试", "config": {"seed": 42}}
    assert client.post("/api/templates", json=payload).status_code == 201
    payload["config"]["seed"] = 43
    assert client.post("/api/templates", json=payload).status_code == 201
    versions = client.get("/api/templates").json()
    assert [v["config"]["seed"] for v in versions] == [43, 42]
    assert (
        client.post(
            "/api/templates", json=payload, headers={"Origin": "http://evil.invalid"}
        ).status_code
        == 403
    )
    assert client.get("/api/meta", headers={"Host": "evil.invalid"}).status_code == 400
    assert (
        client.post("/api/import", json={"path": str(tmp_path.parent)}).status_code
        == 400
    )
    with pytest.raises(ValueError):
        clean_config({"nested": {"api_key": "placeholder"}})


def test_failed_run_and_nonfinite_metrics(tmp_path):
    with pytest.raises(RuntimeError):
        with Run("测试", "失败", home=tmp_path) as run:
            raise RuntimeError("expected failure")
    assert run.store.client.get_run(run.id).info.status == "FAILED"
    with pytest.raises(ValueError):
        run.log({"loss": float("nan")})


def test_tensorboard_import_is_idempotent(client, tmp_path):
    from tensorboard.summary.writer.event_file_writer import EventFileWriter
    from tensorboard.compat.proto.event_pb2 import Event
    from tensorboard.compat.proto.summary_pb2 import Summary

    folder = tmp_path / "logs/version_0"
    folder.mkdir(parents=True)
    writer = EventFileWriter(str(folder))
    writer.add_event(
        Event(
            wall_time=1700000000,
            step=0,
            summary=Summary(value=[Summary.Value(tag="train_loss", simple_value=0.7)]),
        )
    )
    writer.flush()
    writer.close()
    store = client.app.state.store
    first = import_tensorboard(store, tmp_path / "logs")
    second = import_tensorboard(store, tmp_path / "logs")
    assert first[0]["new_points"] == 1 and second[0]["new_points"] == 0
    assert first[0]["id"] == second[0]["id"]


def test_search_executes_real_trials_and_records_parameters(client):
    store = client.app.state.store
    create_study(
        store,
        "search-test",
        "测试项目",
        "grid",
        "minimize",
        {
            "learning_rate": {"type": "categorical", "choices": [0.02, 0.1]},
            "epochs": {"type": "categorical", "choices": [2]},
        },
        2,
    )
    execute_study(store, "search-test")
    result = list_studies(store)[0]
    assert result["completed"] == 2 and result["status"] == "FINISHED"
    assert result["best_value"] > 0 and len(store.runs()) == 2
    assert all(r["status"] == "FINISHED" for r in store.runs())
    assert all(len(store.history(r["id"], "val/loss")) == 2 for r in store.runs())
