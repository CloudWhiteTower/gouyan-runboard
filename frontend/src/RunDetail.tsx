import { useEffect, useState } from "react";
import { Check, Copy, Download, SlidersHorizontal, X } from "lucide-react";
import {
  api,
  loadHistories,
  Run,
  Point,
  metricLabel,
  numeric,
  statusLabel,
  download,
} from "./data";
import { Curves } from "./Charts";
import { Artifacts } from "./Artifacts";
import { useDismiss } from "./motion";

export function RunDetail({
  run,
  initialTab = "metrics",
  close,
  refresh,
  toast,
  onError,
  onTemplate,
}: {
  run: Run;
  initialTab?: "params" | "metrics";
  close: () => void;
  refresh: () => Promise<void>;
  toast: (s: string) => void;
  onError: (s: string) => void;
  onTemplate: () => void;
}) {
  const { leaving, dismiss } = useDismiss(close);
  const [tab, setTab] = useState<string>(initialTab),
    [metric, setMetric] = useState(
      Object.keys(run.metrics).find((key) => key.includes("loss")) ||
        Object.keys(run.metrics)[0] ||
        "",
    );
  const [histories, setHistories] = useState<Record<string, Point[]>>({}),
    [logs, setLogs] = useState<
      {
        id: number;
        stream: string;
        text: string;
        created: number;
        step: number | null;
      }[]
    >([]),
    [query, setQuery] = useState("");
  const [note, setNote] = useState(run.tags["mlflow.note.content"] || ""),
    [name, setName] = useState(run.name),
    [group, setGroup] = useState(run.tags["runboard.group"] || ""),
    [labels, setLabels] = useState(
      (JSON.parse(run.tags["runboard.labels"] || "[]") as string[]).join(", "),
    );
  const resources = Object.keys(run.metrics).filter(
    (key) => key.startsWith("system/") && !key.endsWith("/memory_total_mb"),
  );
  const preferred = [
    "system/gpu/0/utilization_percent",
    "system/gpu/0/memory_used_mb",
    "system/cpu_percent",
    "system/memory_mb",
    "system/host_memory_percent",
    "system/network_received_mb",
  ];
  const systemKeys = [
    ...preferred.filter((key) => resources.includes(key)),
    ...resources.filter((key) => !preferred.includes(key)),
  ].slice(0, 12);
  const environment = JSON.parse(
    run.tags["runboard.environment"] || "{}",
  ) as Record<string, unknown>;
  useEffect(() => {
    let active = true;
    if (tab === "logs")
      api<typeof logs>(
        `/runs/${run.id}/logs?query=${encodeURIComponent(query)}`,
      )
        .then((rows) => {
          if (active) setLogs(rows);
        })
        .catch((error) => onError(error.message));
    const keys =
      tab === "system"
        ? systemKeys
        : tab === "metrics" && metric
          ? [metric]
          : [];
    if (keys.length)
      loadHistories([run.id], keys)
        .then((rows) => {
          if (active)
            setHistories(
              Object.fromEntries(keys.map((key) => [key, rows[key][run.id]])),
            );
        })
        .catch((error) => onError(error.message));
    return () => {
      active = false;
    };
  }, [run, tab, metric, query, onError]);
  async function save(body: unknown) {
    try {
      await api(`/runs/${run.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await refresh();
      toast("已保存");
    } catch (error) {
      onError((error as Error).message);
    }
  }
  const points = histories[metric] || [];
  const stats = points.length
    ? points.reduce(
        (result, point) => ({
          latest: point.value,
          min: Math.min(result.min, point.value),
          max: Math.max(result.max, point.value),
        }),
        { latest: points[0].value, min: points[0].value, max: points[0].value },
      )
    : null;
  const resume = `with Run(run_id="${run.id}") as run:\n    # 从模型 checkpoint 恢复训练后记录指标\n    run.log({"val/loss": val_loss})`;
  return (
    <div
      className={`drawer-backdrop ${leaving ? "leaving" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <aside
        className="detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="实验详情"
      >
        <div className="drawer-top">
          <span>
            实验详情 <span className="mono">/ {run.id.slice(0, 8)}</span>
          </span>
          <button
            className="icon-button"
            onClick={dismiss}
            aria-label="关闭详情"
          >
            <X size={19} />
          </button>
        </div>
        <div className="drawer-heading">
          <span
            className={`status ${run.status === "RUNNING" ? "running" : ""}`}
          >
            {statusLabel(run)}
          </span>
          <h2>{run.name}</h2>
          <div className="detail-actions">
            <button className="button secondary" onClick={onTemplate}>
              <SlidersHorizontal size={13} />
              配置
            </button>
            <button
              className="button secondary"
              onClick={() => download([run.id], "metrics")}
            >
              <Download size={13} />
              指标
            </button>
            <button
              className="button secondary"
              onClick={() => {
                navigator.clipboard
                  .writeText(resume)
                  .then(() => toast("已复制续记代码"))
                  .catch((error) => onError(error.message));
              }}
            >
              <Copy size={13} />
              续记
            </button>
          </div>
        </div>
        <div className="detail-tabs">
          {[
            ["metrics", "指标"],
            ["system", "系统"],
            ["logs", "日志"],
            ["files", "文件"],
            ["params", "参数"],
            ["environment", "环境"],
            ["notes", "管理"],
          ].map(([id, title]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {title}
            </button>
          ))}
        </div>
        <div className="drawer-content" key={tab}>
          {tab === "metrics" && (
            <>
              <select
                aria-label="详情曲线指标"
                value={metric}
                onChange={(event) => setMetric(event.target.value)}
              >
                {Object.keys(run.metrics)
                  .filter((key) => !key.startsWith("system/"))
                  .map((key) => (
                    <option key={key} value={key}>
                      {metricLabel(key)}
                    </option>
                  ))}
              </select>
              {stats && (
                <div className="detail-metric-grid statistics">
                  {[
                    ["最近", stats.latest],
                    ["最小", stats.min],
                    ["最大", stats.max],
                  ].map(([title, value]) => (
                    <div key={title}>
                      <span>{title}</span>
                      <strong>{numeric(value)}</strong>
                    </div>
                  ))}
                </div>
              )}
              {points.length ? (
                <Curves
                  runs={[run]}
                  metric={metric}
                  histories={{ [run.id]: points }}
                  height={300}
                />
              ) : (
                <div className="empty small">暂无指标</div>
              )}
            </>
          )}
          {tab === "system" && (
            <>
              {systemKeys.length ? (
                <div className="system-charts">
                  {systemKeys.map((key) => (
                    <section key={key}>
                      <h3>{metricLabel(key)}</h3>
                      <Curves
                        runs={[run]}
                        metric={key}
                        histories={{ [run.id]: histories[key] || [] }}
                        height={220}
                      />
                    </section>
                  ))}
                </div>
              ) : (
                <div className="empty small">暂无监控数据</div>
              )}
            </>
          )}
          {tab === "logs" && (
            <>
              <div className="log-tools">
                <input
                  aria-label="搜索日志"
                  placeholder="搜索日志"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <button
                  className="text-button"
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([logs.map((line) => line.text).join("\n")], {
                        type: "text/plain;charset=utf-8",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "training.log";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download size={14} />
                  导出当前
                </button>
              </div>
              <div className="log-output" role="log" aria-label="训练日志">
                {logs.length ? (
                  logs.map((line) => (
                    <div
                      key={line.id}
                      className={line.stream === "stderr" ? "stderr" : ""}
                    >
                      <time>
                        {new Date(line.created).toLocaleTimeString("zh-CN", {
                          hour12: false,
                        })}
                      </time>
                      <pre>{line.text}</pre>
                    </div>
                  ))
                ) : (
                  <span className="muted">暂无日志</span>
                )}
              </div>
            </>
          )}
          {tab === "files" && (
            <Artifacts rid={run.id} refreshKey={run} onError={onError} />
          )}
          {tab === "params" && (
            <>
              <div className="key-value-list">
                {Object.entries(
                  Object.keys(run.config).length ? run.config : run.params,
                ).map(([key, value]) => (
                  <div key={key}>
                    <span>{key}</span>
                    <code>
                      {typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)}
                    </code>
                  </div>
                ))}
              </div>
              <button
                className="button secondary"
                onClick={() => download([run.id], "config")}
              >
                <Download size={13} />
                导出配置
              </button>
            </>
          )}
          {tab === "environment" && (
            <div className="key-value-list">
              {Object.keys(environment).length ? (
                Object.entries(environment).map(([key, value]) => (
                  <div key={key}>
                    <span>
                      {(
                        {
                          python: "Python",
                          os: "系统",
                          os_release: "系统版本",
                          architecture: "架构",
                          packages: "依赖版本",
                        } as Record<string, string>
                      )[key] || key}
                    </span>
                    <code>
                      {typeof value === "object"
                        ? JSON.stringify(value, null, 2)
                        : String(value)}
                    </code>
                  </div>
                ))
              ) : (
                <div>暂无环境记录</div>
              )}
            </div>
          )}
          {tab === "notes" && (
            <>
              <label className="field">
                名称
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="field">
                分组
                <input
                  aria-label="实验分组"
                  value={group}
                  maxLength={100}
                  onChange={(event) => setGroup(event.target.value)}
                />
              </label>
              <label className="field">
                标签
                <input
                  aria-label="实验标签"
                  value={labels}
                  placeholder="标签，以逗号分隔"
                  onChange={(event) => setLabels(event.target.value)}
                />
              </label>
              <label className="field">
                笔记
                <textarea
                  className="note-editor"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <button
                className="button primary"
                onClick={() =>
                  save({
                    name,
                    note,
                    group,
                    labels: labels
                      .split(/[,，]/)
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
              >
                <Check size={14} />
                保存
              </button>
              <div className="management-row">
                <strong>归档</strong>
                <button
                  className="button secondary"
                  onClick={() =>
                    save({ archived: run.tags["runboard.archived"] !== "true" })
                  }
                >
                  {run.tags["runboard.archived"] === "true"
                    ? "取消归档"
                    : "归档"}
                </button>
              </div>
              {run.status === "RUNNING" && (
                <div className="management-row">
                  <div>
                    <strong>记录状态</strong>
                    <p>仅修改记录状态</p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => save({ status: "KILLED" })}
                  >
                    标记停止
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
