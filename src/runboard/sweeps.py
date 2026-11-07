"""Persistent Optuna studies and a genuine, small CPU training example."""

from __future__ import annotations

import math
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
import optuna
from . import Run

optuna.logging.set_verbosity(optuna.logging.WARNING)
EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="runboard-study")
STOP = {}


def storage_url(store):
    return f"sqlite:///{(store.home / 'search.db').as_posix()}"


def validate_space(space, sampler):
    if not space or len(space) > 30:
        raise ValueError("搜索空间应包含 1—30 个参数。")
    for name, item in space.items():
        if not isinstance(item, dict):
            raise ValueError(f"{name} 应包含 type 及对应的范围或候选值。")
        if item.get("type") == "categorical":
            if not item.get("choices") or len(item["choices"]) > 100:
                raise ValueError(f"{name} 的候选值应为 1—100 项。")
        elif item.get("type") in ("float", "int"):
            if not isinstance(item.get("low"), (int, float)) or not isinstance(
                item.get("high"), (int, float)
            ):
                raise ValueError(f"{name} 应提供数值上下界 low 和 high。")
            if (
                not math.isfinite(item["low"])
                or not math.isfinite(item["high"])
                or item["low"] > item["high"]
            ):
                raise ValueError(f"{name} 的上下界不合法。")
            if item.get("log") and item["low"] <= 0:
                raise ValueError("对数搜索的下界必须大于零。")
            if sampler == "grid":
                raise ValueError("网格搜索请把所有参数写成 categorical 候选列表。")
        else:
            raise ValueError("参数 type 应为 float、int 或 categorical。")


def sample(trial, space):
    config = {}
    for name, item in space.items():
        if item["type"] == "categorical":
            config[name] = trial.suggest_categorical(name, item["choices"])
        elif item["type"] == "int":
            config[name] = trial.suggest_int(
                name, int(item["low"]), int(item["high"]), log=item.get("log", False)
            )
        else:
            config[name] = trial.suggest_float(
                name, item["low"], item["high"], log=item.get("log", False)
            )
    return config


def train_example(run, config, cancelled=lambda: False):
    """Logistic regression trained by actual full-batch gradient descent.

    Synthetic classification data are explicitly marked as a monitor example;
    validation split is fixed across trials, independent of the test set.
    """
    rng = random.Random(int(config.get("seed", 42)))
    samples = []
    for _ in range(240):
        x = [rng.gauss(0, 1) for _ in range(4)]
        y = int(1.5 * x[0] - x[1] + 0.6 * x[2] + rng.gauss(0, 0.65) > 0)
        samples.append((x, y))
    train, val = samples[:192], samples[192:]
    weights, bias = [rng.gauss(0, 0.15) for _ in range(4)], 0.0
    lr, decay = (
        float(config.get("learning_rate", 0.06)),
        float(config.get("weight_decay", 0.001)),
    )
    epochs = int(config.get("epochs", 60))

    def evaluate(rows):
        loss, correct, grad, gb = 0.0, 0, [0.0] * 4, 0.0
        for x, y in rows:
            z = sum(w * v for w, v in zip(weights, x)) + bias
            probability = 1 / (1 + math.exp(-max(-50, min(50, z))))
            loss += max(z, 0) - z * y + math.log1p(math.exp(-abs(z)))
            correct += int((probability >= 0.5) == y)
            for j in range(4):
                grad[j] += (probability - y) * x[j]
            gb += probability - y
        return (
            loss / len(rows),
            correct / len(rows),
            [g / len(rows) for g in grad],
            gb / len(rows),
        )

    best = float("inf")
    for epoch in range(epochs):
        if cancelled():
            run.finish("KILLED")
            return None
        _, _, grad, gb = evaluate(train)
        weights = [w - lr * (g + decay * w) for w, g in zip(weights, grad)]
        bias -= lr * gb
        tl, ta, _, _ = evaluate(train)
        vl, va, _, _ = evaluate(val)
        run.log(
            {
                "train/loss": tl,
                "val/loss": vl,
                "train/accuracy": ta,
                "val/accuracy": va,
                "learning_rate": lr,
                "epoch": epoch,
            },
            step=epoch,
        )
        if epoch % 10 == 0:
            run.system(step=epoch)
        best = min(best, vl)
        time.sleep(0.025)
    import json
    from tempfile import TemporaryDirectory
    from pathlib import Path

    with TemporaryDirectory() as temp:
        path = Path(temp) / "linear-model.json"
        path.write_text(
            json.dumps({"weights": weights, "bias": bias, "validation_loss": vl}),
            encoding="utf-8",
        )
        run.artifact(path, "models")
    return best


def create_study(
    store,
    name,
    project,
    sampler,
    direction,
    space,
    trials,
    objective="example",
    seed=42,
):
    validate_space(space, sampler)
    samplers = {
        "tpe": optuna.samplers.TPESampler(seed=seed),
        "random": optuna.samplers.RandomSampler(seed=seed),
    }
    chosen = (
        optuna.samplers.GridSampler(
            {k: v["choices"] for k, v in space.items()}, seed=seed
        )
        if sampler == "grid"
        else samplers[sampler]
    )
    study = optuna.create_study(
        storage=storage_url(store), study_name=name, direction=direction, sampler=chosen
    )
    for key, value in {
        "project": project,
        "sampler": sampler,
        "space": space,
        "trials": trials,
        "objective": objective,
        "seed": seed,
        "status": "WAITING",
        "created": time.time(),
    }.items():
        study.set_user_attr(key, value)
    return study


def execute_study(store, name, objective_fn=None):
    study = optuna.load_study(study_name=name, storage=storage_url(store))
    attrs = study.user_attrs
    if attrs["sampler"] == "grid":
        sampler = optuna.samplers.GridSampler(
            {k: v["choices"] for k, v in attrs["space"].items()}, seed=attrs["seed"]
        )
    elif attrs["sampler"] == "random":
        sampler = optuna.samplers.RandomSampler(seed=attrs["seed"])
    else:
        sampler = optuna.samplers.TPESampler(seed=attrs["seed"])
    study = optuna.load_study(
        study_name=name, storage=storage_url(store), sampler=sampler
    )
    stop = STOP.setdefault(name, threading.Event())
    stop.clear()
    study.set_user_attr("status", "RUNNING")

    def objective(trial):
        config = {"seed": attrs["seed"], "epochs": 60, **sample(trial, attrs["space"])}
        tags = {
            "runboard.study": name,
            "runboard.trial": str(trial.number),
            "runboard.source": "example" if objective_fn is None else "objective",
        }
        with Run(
            attrs["project"],
            f"{name} · {trial.number + 1:02}",
            config,
            home=store.home,
            tags=tags,
        ) as run:
            trial.set_user_attr("run_id", run.id)
            if objective_fn:
                value = objective_fn(config, run)
            else:
                value = train_example(run, config, stop.is_set)
            if value is None:
                # __exit__ must preserve cancellation status.
                raise optuna.TrialPruned()
            return float(value)

    def after_trial(study, trial):
        if stop.is_set():
            study.stop()

    try:
        remaining = max(0, attrs["trials"] - len(study.trials))
        study.optimize(objective, n_trials=remaining, callbacks=[after_trial])
    except Exception:
        study.set_user_attr("status", "FAILED")
        raise
    else:
        study.set_user_attr("status", "STOPPED" if stop.is_set() else "FINISHED")


def list_studies(store):
    if not (store.home / "search.db").exists():
        return []
    results = []
    for summary in optuna.get_all_study_summaries(storage_url(store)):
        study = optuna.load_study(
            study_name=summary.study_name, storage=storage_url(store)
        )
        done = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]
        best = study.best_trial if done else None
        results.append(
            {
                "name": study.study_name,
                **study.user_attrs,
                "completed": len(done),
                "direction": study.direction.name.lower(),
                "best_value": best.value if best else None,
                "best_params": best.params if best else {},
                "trial_data": [
                    {
                        "number": t.number,
                        "state": t.state.name,
                        "params": t.params,
                        "value": t.value,
                        "run_id": t.user_attrs.get("run_id"),
                    }
                    for t in study.trials
                ],
            }
        )
    return sorted(results, key=lambda s: s.get("created", 0), reverse=True)
