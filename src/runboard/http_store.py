"""Zero-dependency SDK transport for isolated training environments."""

import json
import math
import uuid
from pathlib import Path
from types import SimpleNamespace
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from .validation import clean_config


class HttpStore:
    def __init__(self, server):
        parsed = urlparse(server)
        if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost"):
            raise ValueError(
                "当前 SDK 使用本机 HTTP 服务，请填写 http://127.0.0.1:端口。"
            )
        self.server = server.rstrip("/")
        self.client = self

    def request(self, path, body=None, method=None, headers=None):
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
            headers = {"Content-Type": "application/json", **(headers or {})}
        request = Request(
            self.server + "/api" + path, data=body, method=method, headers=headers or {}
        )
        try:
            with urlopen(request, timeout=30) as response:
                return json.load(response)
        except HTTPError as exc:
            detail = json.load(exc).get("detail", str(exc.code))
            raise RuntimeError(f"RunBoard：{detail}") from None
        except URLError:
            raise RuntimeError(
                "无法连接 RunBoard，请先运行 runboard serve，并核对本机端口。"
            ) from None

    def create_run(self, project, name, config, tags):
        clean_config(config)
        return self.request(
            "/track/runs",
            {"project": project, "name": name, "config": config, "tags": tags or {}},
        )["id"]

    def log(self, rid, values, step):
        values = {k: float(v) for k, v in values.items()}
        if any(not math.isfinite(v) for v in values.values()):
            raise ValueError("指标包含 NaN 或无穷值。")
        self.request(f"/track/runs/{rid}/metrics", {"metrics": values, "step": step})

    def update_config(self, rid, config):
        clean_config(config)
        self.request(f"/track/runs/{rid}/config", {"config": config})

    def resume(self, rid, config=None):
        return self.request(f"/track/runs/{rid}/resume", {"config": config or {}})

    def append_text(self, rid, text, stream="text", step=None):
        self.request(
            f"/track/runs/{rid}/logs", {"text": text, "stream": stream, "step": step}
        )

    def set_terminated(self, rid, status):
        self.request(f"/runs/{rid}", {"status": status}, "PATCH")

    def get_run(self, rid):
        value = self.request(f"/runs/{rid}")
        return SimpleNamespace(info=SimpleNamespace(status=value["status"]))

    def set_tag(self, rid, key, value):
        fields = {
            "mlflow.note.content": "note",
            "runboard.group": "group",
            "runboard.labels": "labels",
            "runboard.environment": "environment",
        }
        if key not in fields:
            raise ValueError("不支持的 SDK 元数据字段。")
        if key in ("runboard.labels", "runboard.environment"):
            value = json.loads(value)
        self.request(f"/runs/{rid}", {fields[key]: value}, "PATCH")

    def log_artifact(self, rid, path, artifact_path=None):
        path = Path(path)
        boundary = "runboard-" + uuid.uuid4().hex
        prefix = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\n{artifact_path or ""}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\nContent-Type: application/octet-stream\r\n\r\n'
        ).encode("utf-8")
        suffix = f"\r\n--{boundary}--\r\n".encode()

        def body():
            yield prefix
            with path.open("rb") as stream:
                while chunk := stream.read(1024 * 1024):
                    yield chunk
            yield suffix

        self.request(
            f"/track/runs/{rid}/artifact",
            body(),
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Content-Length": str(len(prefix) + path.stat().st_size + len(suffix)),
            },
        )
