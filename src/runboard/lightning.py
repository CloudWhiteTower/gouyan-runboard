"""Optional Lightning integration; the server does not depend on PyTorch."""

from lightning.pytorch.loggers.logger import Logger
from lightning.pytorch.utilities.rank_zero import rank_zero_only
from . import Run
from .validation import clean_config


class RunBoardLogger(Logger):
    def __init__(
        self,
        project="蛋白质界面预测",
        name="GAT",
        home=None,
        server=None,
        *,
        run_id=None,
        group=None,
        labels=None,
        monitor_interval=None,
        record_environment=False,
    ):
        super().__init__()
        self._run = Run(
            project=project,
            name=name,
            home=home,
            server=server,
            run_id=run_id,
            group=group,
            labels=labels,
            monitor_interval=monitor_interval,
            record_environment=record_environment,
        )
        self._name = project

    @property
    def name(self):
        return self._name

    @property
    def version(self):
        return self._run.id

    @property
    def experiment(self):
        return self._run

    @rank_zero_only
    def log_hyperparams(self, params):
        values = vars(params) if hasattr(params, "__dict__") else dict(params)
        clean_config(values)
        self._run.params(values)

    @rank_zero_only
    def log_metrics(self, metrics, step=None):
        self._run.log({k: float(v) for k, v in metrics.items()}, step=step)

    @rank_zero_only
    def finalize(self, status):
        self._run.finish("FINISHED" if status == "success" else "FAILED")

    @rank_zero_only
    def after_save_checkpoint(self, checkpoint_callback):
        path = checkpoint_callback.best_model_path
        if path:
            self._run.artifact(path, "checkpoints")
