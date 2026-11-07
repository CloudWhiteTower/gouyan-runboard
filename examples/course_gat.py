"""A two-update GATv2 run on the prepared real protein graphs."""

from pathlib import Path
import lightning as L
import torch
from torch import nn
from torch_geometric.nn import GAT
from torch_geometric.loader import DataLoader
from runboard.lightning import RunBoardLogger


class InterfaceModel(L.LightningModule):
    def __init__(self, learning_rate=0.001, hidden_channels=32, heads=2, seed=42):
        super().__init__()
        self.save_hyperparameters()
        self.model = GAT(
            in_channels=20,
            hidden_channels=hidden_channels,
            num_layers=2,
            heads=heads,
            out_channels=1,
            v2=True,
            jk="last",
        )

    def training_step(self, batch, batch_idx):
        logits = self.model(batch.amino_acid_one_hot.float(), batch.edge_index)
        loss = nn.functional.binary_cross_entropy_with_logits(
            logits, batch.interface_label.float().view(-1, 1)
        )
        self.log(
            "train/loss", loss, on_step=True, on_epoch=True, batch_size=batch.num_nodes
        )
        return loss

    def configure_optimizers(self):
        return torch.optim.Adam(self.parameters(), lr=self.hparams.learning_rate)


def main():
    torch.set_num_threads(2)
    L.seed_everything(42)
    data = (
        Path(__file__).resolve().parents[2]
        / "external/protein_geometric_learning_course/data/20261105_pilot20"
    )
    import json

    split = json.loads((data / "splits.json").read_text(encoding="utf-8"))
    names = split["train"][:4]
    # Trusted caches generated from the downloaded course structures.
    graphs = [
        torch.load(data / "processed" / f"{name}.pt", weights_only=False)
        for name in names
    ]
    logger = RunBoardLogger(
        project="蛋白质界面预测",
        name="GATv2 · RunBoard 两步接入",
        server="http://127.0.0.1:7310",
    )
    logger.experiment.note(
        "真实课程图的两次 CPU 更新，仅验收监控接入；未做验证集评价。使用固定训练划分前四条样本。"
    )
    trainer = L.Trainer(
        max_steps=2,
        accelerator="cpu",
        logger=logger,
        enable_checkpointing=False,
        log_every_n_steps=1,
        enable_progress_bar=False,
        enable_model_summary=False,
    )
    trainer.fit(InterfaceModel(), DataLoader(graphs, batch_size=2, shuffle=False))
    print("RunBoard run ID:", logger.version)


if __name__ == "__main__":
    main()
