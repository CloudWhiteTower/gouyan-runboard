"""构研 RunBoard: explicit local-first tracking with MLflow interoperability."""

from __future__ import annotations

import math
import time
import os
from pathlib import Path

__version__ = "0.3.0"


class Run:
    """Log a training run without requiring a running web server."""

    def __init__(
        self,
        project="默认项目",
        name="新实验",
        config=None,
        *,
        home=None,
        tags=None,
        run_id=None,
        server=None,
        group=None,
        labels=None,
        monitor_interval=None,
        record_environment=False,
    ):
        if monitor_interval is not None and monitor_interval <= 0:
            raise ValueError("监控间隔须大于0秒。")
        server = (
            server
            or os.environ.get("RUNBOARD_URL")
            or (
                "http://127.0.0.1:7310"
                if home is None and not os.environ.get("RUNBOARD_HOME")
                else None
            )
        )
        if server:
            from .http_store import HttpStore

            self.store = HttpStore(server)
        else:
            from .store import Store

            self.store = Store(home)
        self.id = run_id or self.store.create_run(project, name, config or {}, tags)
        self._step = self.store.resume(run_id, config)["next_step"] if run_id else 0
        self._last_system = 0.0
        self._sampler = None
        self._record_environment = record_environment
        self._hardware_recorded = False
        self.monitor_interval = monitor_interval
        if group is not None or labels is not None:
            self.annotate(group=group, labels=labels)
        if record_environment:
            self.environment()

    def log(self, metrics, step=None):
        step = self._step if step is None else int(step)
        if step < 0:
            raise ValueError("步数不能为负数。")
        self.store.log(self.id, metrics, step)
        self._step = max(self._step, step + 1)
        if (
            self.monitor_interval is not None
            and time.monotonic() - self._last_system >= self.monitor_interval
        ):
            self.system(step)

    @property
    def next_step(self):
        return self._step

    def log_epoch(self, epoch: int, seconds: float):
        """Record one completed, 1-based epoch independently of batch steps."""
        if type(epoch) is not int or epoch < 1:
            raise ValueError("已完成轮次须为从 1 开始的整数。")
        if not math.isfinite(seconds) or seconds <= 0:
            raise ValueError("单轮耗时须为大于 0 的有限秒数。")
        self.store.log(
            self.id, {"epoch/completed": epoch, "epoch/seconds": seconds}, epoch
        )

    def system(self, step=None):
        """Explicit process telemetry; no environment variables are collected."""
        from .telemetry import Sampler

        if self._sampler is None:
            self._sampler = Sampler()
        values = self._sampler.collect()
        if self._record_environment and not self._hardware_recorded:
            self.environment()
            self._hardware_recorded = True
        if values:
            self.store.log(
                self.id, values, max(0, self._step - 1) if step is None else int(step)
            )
        self._last_system = time.monotonic()
        return {
            "metrics": values,
            "gpus": self._sampler.devices,
            "gpu_status": self._sampler.gpu_status,
        }

    def environment(self):
        import json
        from .telemetry import environment

        value = environment()
        if self._sampler is not None:
            value.update(
                gpus=self._sampler.devices, gpu_status=self._sampler.gpu_status
            )
        self._record_environment = True
        self.store.client.set_tag(
            self.id, "runboard.environment", json.dumps(value, ensure_ascii=False)
        )
        return value

    def annotate(self, *, group=None, labels=None):
        import json
        from .validation import clean_config

        if group is not None:
            clean_config({"group": group})
            if not isinstance(group, str) or len(group) > 100:
                raise ValueError("分组须为100字符以内的文本。")
            self.store.client.set_tag(self.id, "runboard.group", group)
        if labels is not None:
            if (
                not isinstance(labels, list)
                or len(labels) > 30
                or any(
                    not isinstance(v, str) or not v.strip() or len(v) > 60
                    for v in labels
                )
            ):
                raise ValueError("标签须为最多30个非空文本，每个不超过60字符。")
            self.store.client.set_tag(
                self.id,
                "runboard.labels",
                json.dumps(list(dict.fromkeys(labels)), ensure_ascii=False),
            )

    def text(self, text, *, step=None, stream="text"):
        from .validation import redact_text

        self.store.append_text(self.id, redact_text(text), stream, step)

    def capture_console(self):
        from .console import capture

        return capture(self)

    def image(self, path, folder="images"):
        self.artifact(path, folder)

    def chart(self, name, option, *, step=None):
        """Log a JSON-only ECharts line, bar, scatter or heatmap artifact."""
        import json
        import re
        from tempfile import TemporaryDirectory
        from .validation import clean_config

        clean_config(option)
        slug = re.sub(r"[^\w.-]", "_", name).strip(".") or "chart"
        index = max(0, self._step - 1) if step is None else int(step)
        with TemporaryDirectory() as temp:
            path = Path(temp) / f"{slug}-{index}.json"
            path.write_text(
                json.dumps(
                    {"runboard_chart": 1, "step": index, "option": option},
                    ensure_ascii=False,
                    allow_nan=False,
                ),
                encoding="utf-8",
            )
            self.artifact(path, "charts")

    def histogram(self, name, values, *, bins=30, step=None):
        import math

        values = [float(value) for value in values]
        if (
            not values
            or any(not math.isfinite(value) for value in values)
            or not isinstance(bins, int)
            or not 1 <= bins <= 512
        ):
            raise ValueError("直方图需要有限数值及1至512个分箱。")
        low, high = min(values), max(values)
        width = (high - low) / bins if high > low else 1.0
        counts = [0] * bins
        for value in values:
            counts[min(bins - 1, int((value - low) / width))] += 1
        self.chart(
            name,
            {
                "xAxis": {
                    "type": "category",
                    "data": [f"{low + i * width:.4g}" for i in range(bins)],
                },
                "yAxis": {"type": "value"},
                "series": [{"type": "bar", "data": counts}],
            },
            step=step,
        )

    def artifact(self, path, folder=None):
        self.store.client.log_artifact(
            self.id, str(Path(path).resolve()), artifact_path=folder
        )

    def note(self, text):
        self.store.client.set_tag(self.id, "mlflow.note.content", text)

    def params(self, config):
        self.store.update_config(self.id, config)

    def finish(self, status="FINISHED"):
        self.store.client.set_terminated(self.id, status=status)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.store.client.get_run(self.id).info.status == "RUNNING":
            self.finish("FAILED" if exc_type else "FINISHED")
        return False
