"""MLflow-backed experiment records and small local workspace metadata."""

from __future__ import annotations

import json
import math
import os
import sqlite3
import time
from contextlib import closing, contextmanager
from functools import lru_cache
from pathlib import Path

os.environ.setdefault("MLFLOW_DISABLE_TELEMETRY", "true")
os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "true")
from mlflow import MlflowClient
from mlflow.entities import Metric, Param

from .validation import clean_config


def param_value(value):
    return (
        json.dumps(value, ensure_ascii=False)
        if isinstance(value, (dict, list, bool))
        else str(value)
    )


class Store:
    def __init__(self, home: str | Path | None = None):
        self.home = Path(
            home or os.environ.get("RUNBOARD_HOME", Path.home() / ".runboard")
        ).resolve()
        self.home.mkdir(parents=True, exist_ok=True)
        self.artifacts = self.home / "artifacts"
        self.artifacts.mkdir(exist_ok=True)
        self.tracking_uri = f"sqlite:///{(self.home / 'experiments.db').as_posix()}"
        self.client = MlflowClient(tracking_uri=self.tracking_uri)
        with self.db() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY, name TEXT NOT NULL, project TEXT NOT NULL, config TEXT NOT NULL, created REAL NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS imports (source TEXT PRIMARY KEY, run_id TEXT NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, step INTEGER, stream TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL)"
            )
            db.execute("CREATE INDEX IF NOT EXISTS logs_run ON logs(run_id,id)")

    @contextmanager
    def db(self):
        with closing(sqlite3.connect(self.home / "workspace.db", timeout=20)) as conn:
            conn.row_factory = sqlite3.Row
            with conn:
                yield conn

    def project(self, name: str) -> str:
        project = self.client.get_experiment_by_name(name)
        if project:
            return project.experiment_id
        return self.client.create_experiment(
            name, artifact_location=self.artifacts.as_uri()
        )

    def create_run(self, project: str, name: str, config=None, tags=None):
        config = clean_config(config or {})
        clean_config(tags or {})
        run_tags = {
            "runboard.config": json.dumps(config, ensure_ascii=False),
            "runboard.source": "sdk",
        }
        run_tags.update(tags or {})
        result = self.client.create_run(
            self.project(project), tags=run_tags, run_name=name
        )
        params = [Param(str(k), param_value(v)) for k, v in config.items()]
        if params:
            self.client.log_batch(result.info.run_id, params=params)
        return result.info.run_id

    def log(self, run_id: str, values: dict[str, float], step: int):
        now = int(time.time() * 1000)
        if any(not math.isfinite(float(v)) for v in values.values()):
            raise ValueError("指标包含 NaN 或无穷值，请先检查训练数值。")
        self.client.log_batch(
            run_id, metrics=[Metric(k, float(v), now, step) for k, v in values.items()]
        )
        if values.keys() & {
            "epoch/completed",
            "epoch/seconds",
            "epoch",
            "epoch/minutes",
        }:
            self.epoch_timings.cache_clear()

    @lru_cache(maxsize=2048)
    def epoch_timings(self, run_id, duration_key, latest_epoch, latest_duration):
        """Reuse aggregates between polls, keyed by the latest MLflow metrics."""
        durations = self.history(run_id, duration_key)
        if duration_key == "epoch/seconds":
            by_epoch = {p["step"]: p["value"] for p in durations if p["value"] > 0}
        else:
            # Older adapters recorded epoch numbers and durations on the batch axis.
            epochs = {p["step"]: p["value"] for p in self.history(run_id, "epoch")}
            by_epoch = {}
            for point in sorted(durations, key=lambda p: p["timestamp"]):
                epoch = epochs.get(point["step"], 0)
                if epoch > 0 and float(epoch).is_integer() and point["value"] > 0:
                    by_epoch[int(epoch)] = point["value"] * 60
        if not by_epoch:
            return None, None
        return max(by_epoch), math.fsum(by_epoch.values()) / len(by_epoch)

    def epoch_progress(self, run_id, config, metrics, status):
        total = None
        wrapped = config.get("config", {})
        for settings in (
            config,
            config.get("training"),
            wrapped,
            wrapped.get("training") if isinstance(wrapped, dict) else None,
        ):
            if not isinstance(settings, dict):
                continue
            for key in ("total_epochs", "max_epochs", "epochs", "num_epochs"):
                value = settings.get(key)
                if type(value) is int and value > 0:
                    total = value
                    break
            if total is not None:
                break

        completed, average = None, None
        if "epoch/completed" in metrics:
            completed = int(metrics["epoch/completed"])
            if "epoch/seconds" in metrics:
                _, average = self.epoch_timings(
                    run_id, "epoch/seconds", completed, metrics["epoch/seconds"]
                )
        elif "epoch" in metrics and "epoch/minutes" in metrics:
            completed, average = self.epoch_timings(
                run_id, "epoch/minutes", metrics["epoch"], metrics["epoch/minutes"]
            )

        return {
            "completed": completed,
            "total": total,
            "average_seconds": average,
            "remaining_seconds": max(0, total - completed) * average
            if status == "RUNNING" and None not in (total, completed, average)
            else None,
        }

    def update_config(self, run_id, config):
        clean_config(config)
        current = json.loads(
            self.client.get_run(run_id).data.tags.get("runboard.config", "{}")
        )
        self.client.log_batch(
            run_id, params=[Param(str(k), param_value(v)) for k, v in config.items()]
        )
        self.client.set_tag(
            run_id,
            "runboard.config",
            json.dumps({**current, **config}, ensure_ascii=False),
        )

    def resume(self, run_id, config=None):
        run = self.client.get_run(run_id)
        config = clean_config(config or {})
        if any(
            k in run.data.params and run.data.params[k] != param_value(v)
            for k, v in config.items()
        ):
            raise ValueError("续记实验的已有参数不可改变；更改参数请新建实验。")
        if config:
            self.update_config(run_id, config)
        next_step = 1 + max(
            (
                p.step
                for key in run.data.metrics
                if key not in ("epoch/completed", "epoch/seconds")
                for p in self.client.get_metric_history(run_id, key)
            ),
            default=-1,
        )
        self.client.update_run(run_id, status="RUNNING")
        self.client.set_tag(run_id, "runboard.resumed_at", str(int(time.time() * 1000)))
        return {"next_step": next_step}

    def append_text(self, run_id, text, stream="text", step=None):
        from .validation import redact_text

        self.client.get_run(run_id)
        if stream not in ("text", "stdout", "stderr") or len(text) > 64000:
            raise ValueError("日志类型不支持或单条超过 64000 字符。")
        with self.db() as db:
            db.execute(
                "INSERT INTO logs(run_id,step,stream,text,created) VALUES(?,?,?,?,?)",
                (run_id, step, stream, redact_text(text), int(time.time() * 1000)),
            )

    def text_logs(self, run_id, after=0, limit=500, query=""):
        self.client.get_run(run_id)
        with self.db() as db:
            if after:
                rows = db.execute(
                    "SELECT * FROM logs WHERE run_id=? AND id>? AND instr(lower(text),lower(?))>0 ORDER BY id LIMIT ?",
                    (run_id, after, query, limit),
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM logs WHERE run_id=? AND instr(lower(text),lower(?))>0 ORDER BY id DESC LIMIT ?",
                    (run_id, query, limit),
                ).fetchall()[::-1]
        return [dict(row) for row in rows]

    def run_dict(self, run):
        info, data = run.info, run.data
        config = json.loads(data.tags.get("runboard.config", "{}"))
        return {
            "id": info.run_id,
            "name": info.run_name or info.run_id[:8],
            "project_id": info.experiment_id,
            "status": info.status,
            "start_time": info.start_time,
            "end_time": None if info.status == "RUNNING" else info.end_time,
            "metrics": data.metrics,
            "params": data.params,
            "tags": data.tags,
            "config": config,
            "progress": self.epoch_progress(
                info.run_id, config, data.metrics, info.status
            ),
        }

    def projects(self):
        return [
            {"id": p.experiment_id, "name": p.name}
            for p in self.client.search_experiments()
            if p.name != "Default"
        ]

    def runs(self, project_id=None):
        ids = [project_id] if project_id else [p["id"] for p in self.projects()]
        if not ids:
            return []
        return [
            self.run_dict(r)
            for r in self.client.search_runs(
                ids, max_results=2000, order_by=["attributes.start_time DESC"]
            )
        ]

    def history(self, run_id, metric):
        points = self.client.get_metric_history(run_id, metric)
        # A resumed step may be logged again. Use its newest value for the plot.
        by_step = {}
        for p in sorted(points, key=lambda p: p.timestamp):
            by_step[p.step] = {
                "step": p.step,
                "value": p.value,
                "timestamp": p.timestamp,
            }
        return sorted(by_step.values(), key=lambda p: p["step"])

    def templates(self):
        with self.db() as db:
            rows = db.execute("SELECT * FROM templates ORDER BY id DESC").fetchall()
        return [{**dict(r), "config": json.loads(r["config"])} for r in rows]

    def save_template(self, name, project, config):
        clean_config(config)
        with self.db() as db:
            cursor = db.execute(
                "INSERT INTO templates(name,project,config,created) VALUES(?,?,?,?)",
                (name, project, json.dumps(config, ensure_ascii=False), time.time()),
            )
            return cursor.lastrowid
