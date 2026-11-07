"""Run in the protein-course environment against a running local service."""

import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "src"))
from runboard import Run
from runboard.lightning import RunBoardLogger
import lightning as L
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset


def main():
    # The SDK must not import the service stack in the training process.
    assert "mlflow" not in sys.modules and "fastapi" not in sys.modules
    with Run(
        "SDK 接入验收",
        "Python SDK · 原课程环境",
        {"seed": 42},
        server="http://127.0.0.1:7310",
    ) as run:
        run.log({"train/loss": 0.5}, step=0)
        run.params({"learning_rate": 0.001})
        run.note("在原 protein-course 环境中通过零依赖 HTTP SDK 完成接入检查。")
        run.artifact(__file__, "verification")

    class TestModel(L.LightningModule):
        def __init__(self):
            super().__init__()
            self.save_hyperparameters(
                {"learning_rate": 0.01, "seed": 42, "model": "Linear · SDK 检查"}
            )
            self.net = nn.Linear(2, 1)

        def training_step(self, batch, batch_idx):
            x, y = batch
            loss = nn.functional.mse_loss(self.net(x), y)
            self.log("train/loss", loss, on_step=True, on_epoch=True)
            return loss

        def configure_optimizers(self):
            return torch.optim.SGD(self.parameters(), lr=0.01)

    L.seed_everything(42)
    dataset = TensorDataset(torch.randn(16, 2), torch.randn(16, 1))
    logger = RunBoardLogger(
        project="SDK 接入验收",
        name="Lightning · 两步真实更新",
        server="http://127.0.0.1:7310",
    )
    trainer = L.Trainer(
        logger=logger,
        max_steps=2,
        accelerator="cpu",
        enable_progress_bar=False,
        enable_model_summary=False,
        enable_checkpointing=False,
        log_every_n_steps=1,
    )
    trainer.fit(TestModel(), DataLoader(dataset, batch_size=4))
    assert "mlflow" not in sys.modules and "fastapi" not in sys.modules
    print(
        "PASS: Python SDK + artifact upload + Lightning 2 optimizer updates; service dependencies not imported"
    )


if __name__ == "__main__":
    main()
