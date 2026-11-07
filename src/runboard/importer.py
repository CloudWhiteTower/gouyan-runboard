"""Read TensorBoard logs into MLflow without modifying the original files."""

import re
from tempfile import TemporaryDirectory
from pathlib import Path
from mlflow.entities import Metric
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator
from tensorboard.util import tensor_util
from tensorboard.plugins.hparams.plugin_data_pb2 import HParamsPluginData


def import_tensorboard(store, path, project="蛋白质界面预测"):
    root = Path(path).expanduser().resolve()
    if not root.is_dir():
        raise ValueError("日志目录不存在，请填写包含事件文件的目录。")
    folders = sorted({p.parent for p in root.rglob("events.out.tfevents*")})
    if not folders:
        raise ValueError("目录中没有 TensorBoard 事件文件。")
    results = []
    for folder in folders:
        source = str(folder)
        with store.db() as db:
            row = db.execute(
                "SELECT run_id FROM imports WHERE source=?", (source,)
            ).fetchone()
        accumulator = EventAccumulator(
            str(folder), size_guidance={"scalars": 0, "tensors": 0, "images": 4}
        ).Reload()
        params = {}
        # Lightning hparams are stored in plugin metadata, not in metric scalars.
        from tensorboard.backend.event_processing.event_file_loader import (
            EventFileLoader,
        )

        for event_path in sorted(folder.glob("events.out.tfevents*")):
            for event in EventFileLoader(str(event_path)).Load():
                for value in event.summary.value:
                    if value.metadata.plugin_data.plugin_name == "hparams":
                        data = HParamsPluginData.FromString(
                            value.metadata.plugin_data.content
                        )
                        for key, item in data.session_start_info.hparams.items():
                            params[key] = getattr(item, item.WhichOneof("kind"))
        rid = (
            row[0]
            if row
            else store.create_run(
                project,
                folder.relative_to(root).as_posix() or folder.name,
                params,
                {"runboard.source": "tensorboard", "runboard.import_path": source},
            )
        )
        tags = accumulator.Tags()
        values = {}
        for tag in tags.get("scalars", []):
            values[tag] = [
                (p.step, p.wall_time, p.value) for p in accumulator.Scalars(tag)
            ]
        for tag in tags.get("tensors", []):
            if tag.startswith("_hparams_"):
                continue
            points = []
            for p in accumulator.Tensors(tag):
                array = tensor_util.make_ndarray(p.tensor_proto)
                if array.size == 1 and array.dtype.kind in "fiu":
                    points.append((p.step, p.wall_time, float(array.reshape(-1)[0])))
            if points:
                values[tag] = points
        count = 0
        for tag, points in values.items():
            existing = {
                (p.step, p.timestamp, p.value)
                for p in store.client.get_metric_history(rid, tag)
            }
            metrics = [
                Metric(tag, float(v), int(t * 1000), s)
                for s, t, v in points
                if (s, int(t * 1000), float(v)) not in existing
            ]
            for offset in range(0, len(metrics), 500):
                store.client.log_batch(rid, metrics=metrics[offset : offset + 500])
            count += len(metrics)
        # Preserve the latest four images per tag (e.g. ROC/PR figures).
        images = 0
        with TemporaryDirectory() as temp:
            for tag in tags.get("images", []):
                for event in accumulator.Images(tag):
                    filename = re.sub(r"[^\w.-]", "_", tag) + f"--step-{event.step}.png"
                    file = Path(temp) / filename
                    file.write_bytes(event.encoded_image_string)
                    store.client.log_artifact(
                        rid, str(file), artifact_path="tensorboard-images"
                    )
                    images += 1
        store.client.set_terminated(rid)
        with store.db() as db:
            db.execute(
                "INSERT OR REPLACE INTO imports(source,run_id) VALUES(?,?)",
                (source, rid),
            )
        results.append(
            {
                "id": rid,
                "name": store.client.get_run(rid).info.run_name,
                "new_points": count,
                "images": images,
            }
        )
    return results
