export type Run = {
  id: string;
  name: string;
  project_id: string;
  status: string;
  start_time: number;
  end_time: number | null;
  metrics: Record<string, number>;
  params: Record<string, string>;
  tags: Record<string, string>;
  config: Record<string, unknown>;
};
export type Point = { step: number; value: number; timestamp: number };
export type Project = { id: string; name: string };
export type Template = {
  id: number;
  name: string;
  project: string;
  config: Record<string, unknown>;
  created: number;
};
export type Study = {
  name: string;
  project: string;
  sampler: string;
  status: string;
  objective: string;
  direction: string;
  trials: number;
  completed: number;
  best_value: number | null;
  best_params: Record<string, unknown>;
  space: Record<string, unknown>;
  trial_data: {
    number: number;
    state: string;
    params: Record<string, unknown>;
    value: number | null;
    run_id?: string;
  }[];
};
export type Meta = {
  home: string;
  workspace: string;
  suggested_logs: string[];
  version: string;
  license: string;
  backend: string;
};
export const colors = [
  "#d3462b",
  "#2f3d4a",
  "#7e9281",
  "#b18b50",
  "#7b7395",
  "#409a9d",
];
export const numeric = (v: unknown) =>
  typeof v === "number"
    ? Number.isInteger(v)
      ? String(v)
      : Math.abs(v) < 0.001 && v !== 0
        ? v.toExponential(2)
        : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
    : v === undefined
      ? "—"
      : String(v);
export const labels: Record<string, string> = {
  "train/loss": "训练损失",
  "val/loss": "验证损失",
  train_loss_epoch: "训练损失 · Epoch",
  train_loss_step: "训练损失 · Step",
  val_loss: "验证损失",
  val_loss_epoch: "验证损失 · Epoch",
  "train/accuracy": "训练准确率",
  "val/accuracy": "验证准确率",
  learning_rate: "学习率",
  "train/loss_epoch": "训练损失",
  "train/loss_step": "训练损失",
  val_loss_step: "验证损失",
  "ROC/val_AUC": "验证 ROC-AUC",
  "PR/val_AUC": "验证 PR-AUC",
  "ROC/train_AUC": "训练 ROC-AUC",
  "PR/train_AUC": "训练 PR-AUC",
  epoch: "训练轮次",
  "system/memory_mb": "进程内存 / MB",
  "system/cpu_percent": "进程 CPU / %",
};
export const metricLabel = (m: string) => {
  if (labels[m]) return labels[m];
  const gpu = m.match(/^system\/gpu\/(\d+)\/(.+)$/);
  if (gpu)
    return `GPU ${gpu[1]} · ${({ utilization_percent: "利用率 / %", memory_used_mb: "显存 / MB", memory_total_mb: "总显存 / MB", temperature_c: "温度 / °C", power_w: "功率 / W" } as Record<string, string>)[gpu[2]] || gpu[2]}`;
  return (
    (
      {
        "system/host_cpu_percent": "主机 CPU / %",
        "system/host_memory_percent": "主机内存 / %",
        "system/disk_read_mb": "磁盘读取累计 / MB",
        "system/disk_write_mb": "磁盘写入累计 / MB",
        "system/network_sent_mb": "网络发送累计 / MB",
        "system/network_received_mb": "网络接收累计 / MB",
      } as Record<string, string>
    )[m] || m
  );
};
export const valLoss = (r: Run) =>
  r.metrics["val/loss"] ?? r.metrics.val_loss_epoch ?? r.metrics.val_loss;
export const statusLabel = (r: Run) =>
  r.tags["runboard.draft"] === "true"
    ? "配置草稿"
    : r.tags["runboard.source"] === "tensorboard"
      ? "日志快照"
      : {
          RUNNING: "运行中",
          FINISHED: "已完成",
          FAILED: "失败",
          KILLED: "已停止",
        }[r.status] || r.status;
export const sourceLabel = (r: Run) =>
  ({
    tensorboard: "TensorBoard 导入",
    example: "功能示例",
    manual: "配置草稿",
    objective: "自定义训练",
    sdk: "训练 SDK",
  })[r.tags["runboard.source"]] || "训练 SDK";
export const date = (t: number) =>
  new Date(t).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch("/api" + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : JSON.stringify(body.detail),
    );
  }
  return res.json();
}
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
export const loadHistories = (runIds: string[], metrics: string[]) =>
  post<Record<string, Record<string, Point[]>>>("/histories", {
    run_ids: runIds,
    metrics,
  });
export const download = (ids: string[], kind = "summary") =>
  window.open(
    `/api/export?ids=${ids.join(",")}&kind=${kind}`,
    "_blank",
    "noopener",
  );
