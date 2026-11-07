"""Chinese local workspace API. Training data remain in the MLflow store."""

from __future__ import annotations

import csv
import io
import json
import time
from pathlib import Path, PurePosixPath
from typing import Annotated, Any, Literal
from urllib.parse import urlparse
from urllib.request import url2pathname

import psutil
from fastapi import FastAPI, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware
from mlflow.exceptions import MlflowException

from . import __version__
from .store import Store, clean_config
from .importer import import_tensorboard
from .sweeps import create_study, list_studies, execute_study, EXECUTOR, STOP
from .telemetry import Sampler


class ProjectInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class RunInput(BaseModel):
    project: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=150)
    config: dict[str, Any] = Field(default_factory=dict)
    tags: dict[str, str] = Field(default_factory=dict)


class MetricsInput(BaseModel):
    metrics: dict[str, float]
    step: int = Field(ge=0)


class ConfigInput(BaseModel):
    config: dict[str, Any]


class HistoriesInput(BaseModel):
    run_ids: list[str] = Field(min_length=1, max_length=6)
    metrics: list[str] = Field(min_length=1, max_length=12)


class RunPatch(BaseModel):
    name: str | None = Field(default=None, max_length=150)
    note: str | None = Field(default=None, max_length=8000)
    pinned: bool | None = None
    archived: bool | None = None
    status: Literal["FINISHED", "FAILED", "KILLED"] | None = None
    group: str | None = Field(default=None, max_length=100)
    labels: list[Annotated[str, Field(min_length=1, max_length=60)]] | None = Field(
        default=None, max_length=30
    )
    environment: dict[str, Any] | None = None


class TextInput(BaseModel):
    text: str = Field(max_length=64000)
    stream: Literal["text", "stdout", "stderr"] = "text"
    step: int | None = Field(default=None, ge=0)


class TemplateInput(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    project: str = Field(min_length=1, max_length=100)
    config: dict[str, Any]


class ImportInput(BaseModel):
    path: str
    project: str = "蛋白质界面预测"


class SweepInput(BaseModel):
    name: str = Field(min_length=1, max_length=100, pattern=r"^[\w\-\u4e00-\u9fff ]+$")
    project: str = Field(min_length=1, max_length=100)
    sampler: Literal["tpe", "random", "grid"] = "tpe"
    direction: Literal["minimize", "maximize"] = "minimize"
    trials: int = Field(default=6, ge=1, le=100)
    seed: int = 42
    space: dict[str, Any]
    objective: Literal["example", "external"] = "example"


def create_app(home=None, workspace=None):
    store = Store(home)
    workspace = Path(workspace or Path.cwd()).resolve()
    app = FastAPI(title="构研 RunBoard", version=__version__)
    app.state.store = store
    sampler = Sampler()
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver"]
    )

    @app.middleware("http")
    async def same_origin(request: Request, call_next):
        # This local service has no public login. Reject browser cross-origin writes.
        origin = request.headers.get("origin")
        if request.method not in ("GET", "HEAD", "OPTIONS") and origin:
            if urlparse(origin).netloc != request.headers.get("host"):
                return JSONResponse(
                    {"detail": "请从 RunBoard 本机页面发起操作。"}, status_code=403
                )
        return await call_next(request)

    @app.exception_handler(ValueError)
    async def invalid(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(MlflowException)
    async def mlflow_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.get("/api/meta")
    def meta():
        choices = [
            workspace / "lightning_logs",
            workspace
            / "code/external/protein_geometric_learning_course/upstream_zh/lightning_logs",
            workspace
            / "external/protein_geometric_learning_course/upstream_zh/lightning_logs",
        ]
        return {
            "name": "构研 RunBoard",
            "version": __version__,
            "home": str(store.home),
            "workspace": str(workspace),
            "suggested_logs": [str(p) for p in choices if p.is_dir()],
            "license": "Apache-2.0",
            "backend": "MLflow + SQLite",
            "time": int(time.time() * 1000),
        }

    @app.get("/api/system")
    def system():
        memory = psutil.virtual_memory()
        values = sampler.collect()
        return {
            "cpu_percent": values.get("system/host_cpu_percent", 0),
            "memory_percent": memory.percent,
            "memory_used_gb": memory.used / 1024**3,
            "memory_total_gb": memory.total / 1024**3,
            "disk_free_gb": psutil.disk_usage(str(store.home)).free / 1024**3,
            "gpus": [
                {
                    **device,
                    "utilization_percent": values.get(
                        f"system/gpu/{device['index']}/utilization_percent"
                    ),
                    "memory_used_mb": values.get(
                        f"system/gpu/{device['index']}/memory_used_mb"
                    ),
                }
                for device in sampler.devices
            ],
            "gpu_status": sampler.gpu_status,
        }

    @app.get("/api/projects")
    def projects():
        return store.projects()

    @app.post("/api/projects", status_code=201)
    def add_project(body: ProjectInput):
        return {"id": store.project(body.name.strip())}

    @app.get("/api/runs")
    def runs(project_id: str | None = None):
        return store.runs(project_id)

    @app.post("/api/runs", status_code=201)
    def add_run(body: RunInput):
        rid = store.create_run(
            body.project, body.name, body.config, {"runboard.source": "manual"}
        )
        store.client.set_terminated(rid, status="KILLED")
        store.client.set_tag(rid, "runboard.draft", "true")
        return {"id": rid}

    @app.get("/api/runs/{rid}")
    def run(rid: str):
        return store.run_dict(store.client.get_run(rid))

    @app.post("/api/track/runs", status_code=201)
    def track_run(body: RunInput):
        return {
            "id": store.create_run(
                body.project,
                body.name,
                body.config,
                {**body.tags, "runboard.source": "sdk"},
            )
        }

    @app.post("/api/track/runs/{rid}/metrics")
    def track_metrics(rid: str, body: MetricsInput):
        store.log(rid, body.metrics, body.step)
        return {"ok": True}

    @app.post("/api/track/runs/{rid}/config")
    def track_config(rid: str, body: ConfigInput):
        store.update_config(rid, body.config)
        return {"ok": True}

    @app.post("/api/track/runs/{rid}/resume")
    def resume(rid: str, body: ConfigInput):
        return store.resume(rid, body.config)

    @app.post("/api/track/runs/{rid}/logs")
    def append_logs(rid: str, body: TextInput):
        store.append_text(rid, body.text, body.stream, body.step)
        return {"ok": True}

    @app.get("/api/runs/{rid}/logs")
    def logs(
        rid: str,
        after: int = Query(0, ge=0),
        limit: int = Query(500, ge=1, le=2000),
        query: str = Query("", max_length=200),
    ):
        return store.text_logs(rid, after, limit, query)

    @app.post("/api/track/runs/{rid}/artifact")
    def track_artifact(rid: str, file: UploadFile = File(...), folder: str = Form("")):
        from tempfile import TemporaryDirectory
        import shutil

        if folder and (
            ".." in PurePosixPath(folder).parts
            or PurePosixPath(folder).is_absolute()
            or "\\" in folder
        ):
            raise HTTPException(400, "产物目录不合法")
        with TemporaryDirectory() as temp:
            target = Path(temp) / Path(file.filename or "artifact.bin").name
            with target.open("wb") as output:
                shutil.copyfileobj(file.file, output)
            store.client.log_artifact(rid, str(target), artifact_path=folder or None)
        return {"ok": True}

    @app.patch("/api/runs/{rid}")
    def patch(rid: str, body: RunPatch):
        store.client.get_run(rid)
        for key, value in {
            "mlflow.runName": body.name,
            "mlflow.note.content": body.note,
            "runboard.group": body.group,
            "runboard.labels": None
            if body.labels is None
            else json.dumps(list(dict.fromkeys(body.labels)), ensure_ascii=False),
            "runboard.pinned": None
            if body.pinned is None
            else str(body.pinned).lower(),
            "runboard.archived": None
            if body.archived is None
            else str(body.archived).lower(),
        }.items():
            if value is not None:
                store.client.set_tag(rid, key, value)
        if body.environment is not None:
            clean_config(body.environment)
            store.client.set_tag(
                rid,
                "runboard.environment",
                json.dumps(body.environment, ensure_ascii=False),
            )
        if body.status:
            store.client.set_terminated(rid, body.status)
        return store.run_dict(store.client.get_run(rid))

    @app.get("/api/runs/{rid}/history")
    def history(rid: str, metric: str):
        return store.history(rid, metric)

    @app.post("/api/histories")
    def histories(body: HistoriesInput):
        run_ids = list(dict.fromkeys(body.run_ids))
        for rid in run_ids:
            store.client.get_run(rid)
        return {
            metric: {rid: store.history(rid, metric) for rid in run_ids}
            for metric in dict.fromkeys(body.metrics)
        }

    @app.get("/api/runs/{rid}/statistics")
    def statistics(rid: str, metric: str):
        points = store.history(rid, metric)
        if not points:
            return {"count": 0}
        low = min(points, key=lambda p: p["value"])
        high = max(points, key=lambda p: p["value"])
        return {"count": len(points), "last": points[-1], "min": low, "max": high}

    @app.get("/api/runs/{rid}/artifacts")
    def artifacts(rid: str, path: str | None = None):
        if path and (
            ".." in PurePosixPath(path).parts or PurePosixPath(path).is_absolute()
        ):
            raise HTTPException(400, "文件路径不合法")
        return [
            {"path": f.path, "is_dir": f.is_dir, "size": f.file_size}
            for f in store.client.list_artifacts(rid, path)
        ]

    @app.get("/api/runs/{rid}/download")
    def download(rid: str, path: str, inline: bool = False, preview: bool = False):
        if (
            ".." in PurePosixPath(path).parts
            or PurePosixPath(path).is_absolute()
            or "\\" in path
        ):
            raise HTTPException(400, "文件路径不合法")
        uri = urlparse(store.client.get_run(rid).info.artifact_uri)
        if uri.scheme != "file":
            raise HTTPException(400, "当前工作台仅提供本地实验产物")
        base = Path(url2pathname(uri.path)).resolve()
        local = (base / path).resolve()
        if (
            not local.is_relative_to(base)
            or not local.is_relative_to(store.artifacts)
            or not local.is_file()
        ):
            raise HTTPException(404, "文件不在本工作区中")
        if preview:
            if local.suffix.lower() not in (
                ".txt",
                ".log",
                ".csv",
                ".tsv",
                ".json",
                ".yaml",
                ".yml",
                ".md",
                ".pdb",
                ".cif",
                ".sdf",
                ".py",
            ):
                raise HTTPException(400, "此文件请下载查看")
            with local.open("rb") as stream:
                raw = stream.read(1024 * 1024 + 1)
            return {
                "text": raw[: 1024 * 1024].decode("utf-8", errors="replace"),
                "truncated": len(raw) > 1024 * 1024,
            }
        if inline and local.suffix.lower() not in (
            ".png",
            ".jpg",
            ".jpeg",
            ".webp",
            ".gif",
            ".mp4",
            ".webm",
            ".mp3",
            ".wav",
            ".ogg",
        ):
            raise HTTPException(400, "仅支持图片、音频和视频的内联预览")
        return FileResponse(
            local,
            filename=local.name,
            content_disposition_type="inline" if inline else "attachment",
        )

    @app.get("/api/templates")
    def templates():
        return store.templates()

    @app.post("/api/templates", status_code=201)
    def add_template(body: TemplateInput):
        return {"id": store.save_template(body.name, body.project, body.config)}

    @app.post("/api/import")
    def import_logs(body: ImportInput):
        path = Path(body.path).expanduser().resolve()
        if not path.is_relative_to(workspace):
            raise HTTPException(
                400,
                "请导入当前工作目录内的日志；其他目录可通过启动时 --workspace 指定。",
            )
        return {"runs": import_tensorboard(store, path, body.project)}

    @app.get("/api/studies")
    def studies():
        return list_studies(store)

    @app.post("/api/studies", status_code=201)
    def add_study(body: SweepInput):
        clean_config(body.space)
        existing = {s["name"] for s in list_studies(store)}
        if body.name in existing:
            raise HTTPException(409, "搜索任务名称已存在，请使用新名称。")
        create_study(
            store,
            body.name,
            body.project,
            body.sampler,
            body.direction,
            body.space,
            body.trials,
            body.objective,
            body.seed,
        )
        return {"name": body.name}

    @app.post("/api/studies/{name}/start")
    def start_study(name: str):
        study = next((s for s in list_studies(store) if s["name"] == name), None)
        if not study:
            raise HTTPException(404, "搜索任务不存在")
        if study["status"] == "RUNNING":
            raise HTTPException(409, "任务正在执行")
        if study["objective"] == "external":
            raise HTTPException(
                400,
                "请用 runboard worker --study 任务名 --objective 模块:函数 接入自己的训练代码。",
            )
        EXECUTOR.submit(execute_study, store, name)
        return {"status": "QUEUED"}

    @app.post("/api/studies/{name}/stop")
    def stop_study(name: str):
        if name not in STOP:
            raise HTTPException(409, "任务尚未在本进程中运行")
        STOP[name].set()
        return {"status": "STOPPING"}

    @app.get("/api/export")
    def export(ids: str, kind: Literal["summary", "metrics", "config"] = "summary"):
        runs = [store.run_dict(store.client.get_run(i)) for i in ids.split(",") if i]
        if kind == "config":
            return Response(
                json.dumps(
                    [{k: r[k] for k in ("id", "name", "config")} for r in runs],
                    ensure_ascii=False,
                    indent=2,
                ),
                media_type="application/json",
                headers={"Content-Disposition": "attachment; filename=configs.json"},
            )
        stream = io.StringIO()
        if kind == "metrics":
            writer = csv.writer(stream)
            writer.writerow(
                ["run_id", "run_name", "metric", "step", "value", "timestamp"]
            )
            for r in runs:
                for metric in r["metrics"]:
                    for point in store.history(r["id"], metric):
                        writer.writerow(
                            [
                                r["id"],
                                r["name"],
                                metric,
                                point["step"],
                                point["value"],
                                point["timestamp"],
                            ]
                        )
        else:
            params = sorted({k for r in runs for k in r["params"]})
            metrics = sorted({k for r in runs for k in r["metrics"]})
            writer = csv.writer(stream)
            writer.writerow(
                ["run_id", "name", "status", *["param/" + k for k in params], *metrics]
            )
            for r in runs:
                writer.writerow(
                    [
                        r["id"],
                        r["name"],
                        r["status"],
                        *[r["params"].get(k, "") for k in params],
                        *[r["metrics"].get(k, "") for k in metrics],
                    ]
                )
        return Response(
            "\ufeff" + stream.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={kind}.csv"},
        )

    web = Path(__file__).parent / "web"
    if web.is_dir():
        app.mount("/", StaticFiles(directory=web, html=True), name="web")
    return app
