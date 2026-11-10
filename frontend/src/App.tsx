import { useEffect, useState, useCallback } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  FolderOpen,
  GitCompareArrows,
  LayoutDashboard,
  LoaderCircle,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Square,
  Terminal,
  Upload,
  X,
  Info,
} from "lucide-react";
import {
  api,
  post,
  loadHistories,
  Run,
  Project,
  Template,
  Study,
  Meta,
  Point,
  colors,
  numeric,
  metricLabel,
  statusLabel,
  sourceLabel,
  date,
  duration,
  download,
} from "./data";
import { Curves, Parallel, TimeAxis } from "./Charts";
import { RunDetail } from "./RunDetail";
import { Artifacts } from "./Artifacts";
import { useDismiss } from "./motion";

type Page =
  "overview" | "runs" | "compare" | "configs" | "sweeps" | "files" | "connect";
type Modal = "import" | "new" | "project" | "sweep" | null;
const nav = [
  { id: "overview", label: "实验总览", short: "指标", icon: LayoutDashboard },
  { id: "runs", label: "实验记录", short: "实验", icon: Activity },
  { id: "compare", label: "对比分析", short: "对比", icon: GitCompareArrows },
  { id: "configs", label: "参数配置", short: "配置", icon: SlidersHorizontal },
  { id: "sweeps", label: "超参数搜索", short: "搜索", icon: BarChart3 },
  { id: "files", label: "文件与产物", short: "文件", icon: FolderOpen },
];
const exampleConfig = {
  model: "GATv2",
  in_channels: 20,
  hidden_channels: 32,
  num_layers: 2,
  heads: 2,
  learning_rate: 0.001,
  weight_decay: 0.0001,
  batch_size: 8,
  seed: 42,
};
const exampleSpace = {
  learning_rate: { type: "float", low: 0.01, high: 0.3, log: true },
  weight_decay: { type: "categorical", choices: [0, 0.001, 0.01] },
};
const cls = (...items: (string | false | undefined)[]) =>
  items.filter(Boolean).join(" ");

export default function App() {
  const [savedView] = useState<
    Partial<{
      axis: TimeAxis;
      smooth: number;
      logScale: boolean;
      metricQuery: string;
    }>
  >(() => {
    try {
      return JSON.parse(localStorage.getItem("runboard.view.v1") || "{}");
    } catch {
      return {};
    }
  });
  const [axis, setAxis] = useState<TimeAxis>(savedView.axis || "step"),
    [groupFilter, setGroupFilter] = useState(""),
    [labelFilter, setLabelFilter] = useState("");
  const [page, setPage] = useState<Page>("overview"),
    [runs, setRuns] = useState<Run[]>([]),
    [projects, setProjects] = useState<Project[]>([]),
    [templates, setTemplates] = useState<Template[]>([]),
    [studies, setStudies] = useState<Study[]>([]),
    [meta, setMeta] = useState<Meta>(),
    [system, setSystem] = useState<Record<string, number>>({});
  const [project, setProject] = useState("all"),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState<string[]>([]),
    [detail, setDetail] = useState<{ id: string; tab?: "params" } | null>(null),
    [modal, setModal] = useState<Modal>(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [live, setLive] = useState(true),
    [updated, setUpdated] = useState(Date.now());
  const [metric, setMetric] = useState("val/loss"),
    [histories, setHistories] = useState<Record<string, Point[]>>({}),
    [smooth, setSmooth] = useState(savedView.smooth || 0),
    [logScale, setLogScale] = useState(savedView.logScale || false);
  const [sort, setSort] = useState("new"),
    [archive, setArchive] = useState(false);
  const [configId, setConfigId] = useState<number | null>(null),
    [configName, setConfigName] = useState("GATv2 · 基准配置"),
    [configText, setConfigText] = useState(
      JSON.stringify(exampleConfig, null, 2),
    );
  const [fileRun, setFileRun] = useState("");
  const [busy, setBusy] = useState(false),
    [metricQuery, setMetricQuery] = useState(savedView.metricQuery || ""),
    [deckHistory, setDeckHistory] = useState<
      Record<string, Record<string, Point[]>>
    >({});
  const toast = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(""), 4500);
  };
  const refresh = useCallback(async () => {
    const [r, p, t, s, m, sys] = await Promise.all([
      api<Run[]>("/runs"),
      api<Project[]>("/projects"),
      api<Template[]>("/templates"),
      api<Study[]>("/studies"),
      api<Meta>("/meta"),
      api<Record<string, number>>("/system"),
    ]);
    setRuns(r);
    setProjects(p);
    setTemplates(t);
    setStudies(s);
    setMeta(m);
    setSystem(sys);
    setUpdated(Date.now());
    setError("");
    setLoading(false);
  }, []);
  useEffect(() => {
    refresh().catch((e) => {
      setError(e.message);
      setLoading(false);
    });
  }, [refresh]);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(
      () => refresh().catch((e) => setError(e.message)),
      4000,
    );
    return () => clearInterval(timer);
  }, [refresh, live]);
  const act = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      toast(message);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const labelsOf = (r: Run): string[] =>
    JSON.parse(r.tags["runboard.labels"] || "[]");
  const allGroups = [
    ...new Set(runs.map((r) => r.tags["runboard.group"]).filter(Boolean)),
  ];
  const allLabels = [...new Set(runs.flatMap(labelsOf))];
  const filtered = runs
    .filter(
      (r) =>
        (!groupFilter || r.tags["runboard.group"] === groupFilter) &&
        (!labelFilter || labelsOf(r).includes(labelFilter)) &&
        (project === "all" || r.project_id === project) &&
        (archive || r.tags["runboard.archived"] !== "true") &&
        (page !== "runs" || status === "all" || r.status === status) &&
        (page !== "runs" ||
          `${r.name} ${Object.values(r.params).join(" ")} ${r.tags["mlflow.note.content"] || ""} ${r.tags["runboard.group"] || ""} ${labelsOf(r).join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "loss"
          ? (a.metrics["val/loss"] ?? Infinity) -
            (b.metrics["val/loss"] ?? Infinity)
          : Number(b.tags["runboard.pinned"] === "true") -
              Number(a.tags["runboard.pinned"] === "true") ||
            b.start_time - a.start_time,
    );
  const chosen = runs.filter((r) => selected.includes(r.id)),
    activeRun = runs.find((r) => r.id === detail?.id);
  const chartRuns = page === "compare" ? chosen : filtered.slice(0, 6);
  const metrics = [...new Set(chartRuns.flatMap((r) => Object.keys(r.metrics)))]
    .filter((k) => !k.startsWith("system/") && k !== "epoch")
    .sort();
  const actualMetric = metrics.includes(metric)
    ? metric
    : metrics.find((k) => k.includes("loss")) || metrics[0] || "val/loss";
  const ids = chartRuns.map((r) => r.id).join(",");
  const groups = [
    ["train_loss_epoch", "train/loss", "train/loss_epoch", "train_loss_step"],
    ["val_loss_epoch", "val/loss", "val_loss"],
    ["ROC/val_AUC", "val/accuracy", "train/accuracy"],
    ["PR/val_AUC", "PR/train_AUC", "ROC/train_AUC"],
  ];
  const defaults = groups
    .map((group) => group.find((key) => metrics.includes(key)))
    .filter((key): key is string => Boolean(key));
  const deckMetrics = (
    metricQuery
      ? metrics.filter((key) =>
          `${metricLabel(key)} ${key}`
            .toLowerCase()
            .includes(metricQuery.toLowerCase()),
        )
      : defaults.length
        ? defaults
        : metrics.slice(0, 4)
  ).slice(0, 12);
  const deckKey = deckMetrics.join("|");
  useEffect(() => {
    if (page !== "overview" || !ids || !deckKey) return;
    let active = true;
    loadHistories(ids.split(","), deckKey.split("|"))
      .then((rows) => {
        if (active) setDeckHistory(rows);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [page, ids, deckKey, updated]);
  useEffect(() => {
    if (page !== "compare") return;
    let valid = true;
    if (!ids) {
      setHistories({});
      return;
    }
    loadHistories(ids.split(","), [actualMetric])
      .then((rows) => {
        if (valid) setHistories(rows[actualMetric]);
      })
      .catch((e) => setError(e.message));
    return () => {
      valid = false;
    };
  }, [page, ids, actualMetric, updated]);
  useEffect(() => {
    if (!fileRun && runs[0]) setFileRun(runs[0].id);
  }, [runs, fileRun]);
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-6),
    );
  const currentProject =
    projects.find((p) => p.id === project)?.name || "全部项目";
  const defaultProject =
    projects.find((p) => p.id === project)?.name ||
    projects[0]?.name ||
    "蛋白质界面预测";
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast("已复制到剪贴板");
  };

  function axisControl() {
    return (
      <select
        aria-label="图表横轴"
        value={axis}
        onChange={(e) => setAxis(e.target.value as TimeAxis)}
      >
        <option value="step">步数</option>
        <option value="relative">相对时间</option>
        <option value="wall">实际时间</option>
      </select>
    );
  }
  function saveView() {
    localStorage.setItem(
      "runboard.view.v1",
      JSON.stringify({ axis, smooth, logScale, metricQuery }),
    );
    toast("视图已保存");
  }
  function metricControls() {
    return (
      <div className="chart-controls">
        <select
          aria-label="选择曲线指标"
          value={actualMetric}
          onChange={(e) => setMetric(e.target.value)}
        >
          {metrics.map((m) => (
            <option key={m} value={m}>
              {metricLabel(m)}
            </option>
          ))}
        </select>
        {axisControl()}
        <span className="control-sep" />
        <label>
          平滑{" "}
          <input
            aria-label="曲线平滑"
            type="range"
            min="0"
            max="0.95"
            step="0.05"
            value={smooth}
            onChange={(e) => setSmooth(+e.target.value)}
          />
          <span className="mono">{smooth.toFixed(2)}</span>
        </label>
        <button
          className={cls("tiny", logScale && "active")}
          onClick={() => setLogScale((s) => !s)}
        >
          对数轴
        </button>
      </div>
    );
  }
  function runTable(compact = false) {
    return (
      <div className="table-scroll">
        <table className={cls("runs-table", compact && "compact")}>
          <thead>
            <tr>
              <th className="check-col">
                <input
                  aria-label="选择当前实验"
                  type="checkbox"
                  checked={
                    filtered.length > 0 &&
                    filtered.slice(0, 6).every((r) => selected.includes(r.id))
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? filtered.slice(0, 6).map((r) => r.id)
                        : [],
                    )
                  }
                />
              </th>
              <th>实验名称</th>
              <th>状态</th>
              <th>训练轮次</th>
              <th>平均每轮</th>
              <th>预计剩余</th>
              {!compact && <th>来源</th>}
              <th className="number">验证损失</th>
              {!compact && <th className="number">验证准确率</th>}
              <th>创建时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, compact ? 5 : 200).map((r, i) => (
              <tr
                key={r.id}
                className={selected.includes(r.id) ? "selected" : ""}
              >
                <td>
                  <input
                    aria-label={`选择 ${r.name}`}
                    type="checkbox"
                    checked={selected.includes(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                </td>
                <td>
                  <button
                    className="run-name"
                    title={r.name}
                    onClick={() => setDetail({ id: r.id })}
                  >
                    <span
                      className="run-dot"
                      style={{ background: colors[i % colors.length] }}
                    />
                    {r.name}
                  </button>
                  <div className="run-labels">
                    {r.tags["runboard.group"] && (
                      <span>{r.tags["runboard.group"]}</span>
                    )}
                    {labelsOf(r).map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                </td>
                <td>
                  <Status run={r} />
                </td>
                <td className="nowrap mono">
                  {r.progress.completed ?? "—"}
                  {r.progress.total !== null && ` / ${r.progress.total}`}
                  {r.progress.total !== null &&
                    r.progress.completed !== null && (
                      <progress
                        className="epoch-progress"
                        aria-label={`${r.name} 训练进度`}
                        value={Math.min(r.progress.completed, r.progress.total)}
                        max={r.progress.total}
                      />
                    )}
                </td>
                <td className="nowrap mono">
                  {duration(r.progress.average_seconds)}
                </td>
                <td className="nowrap mono">
                  {duration(r.progress.remaining_seconds)}
                </td>
                {!compact && (
                  <td>
                    <span className="source">{sourceLabel(r)}</span>
                  </td>
                )}
                <td className="number mono">
                  {numeric(
                    r.metrics["val/loss"] ??
                      r.metrics.val_loss_epoch ??
                      r.metrics.val_loss,
                  )}
                </td>
                {!compact && (
                  <td className="number mono">
                    {r.metrics["val/accuracy"] === undefined
                      ? "—"
                      : (r.metrics["val/accuracy"] * 100).toFixed(1) + "%"}
                  </td>
                )}
                <td className="muted nowrap mono date">{date(r.start_time)}</td>
                <td>
                  <div className="run-actions">
                    <button
                      className="tiny"
                      aria-label={`查看 ${r.name} 的超参数`}
                      onClick={() => setDetail({ id: r.id, tab: "params" })}
                    >
                      参数
                    </button>
                    <button
                      className={cls(
                        "icon-button",
                        r.tags["runboard.pinned"] === "true" && "pinned",
                      )}
                      title="置顶实验"
                      onClick={() =>
                        act(
                          () =>
                            api(`/runs/${r.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({
                                pinned: r.tags["runboard.pinned"] !== "true",
                              }),
                            }),
                          "已更新置顶状态",
                        )
                      }
                    >
                      <Pin size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <Empty
            title={loading ? "加载中" : "暂无实验"}
            action={() => setModal("import")}
            button="导入"
          />
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("overview");
          }}
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>
            构研<span className="brand-en">RunBoard</span>
          </span>
        </a>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              aria-label={n.label}
              title={n.label}
              className={cls("nav-item", page === n.id && "active")}
              onClick={() => setPage(n.id as Page)}
            >
              <n.icon size={17} />
              <span>{n.short}</span>
              {n.id === "runs" && <em>{runs.length}</em>}
              {n.id === "compare" && selected.length > 0 && (
                <em>{selected.length}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={cls("nav-item", page === "connect" && "active")}
            onClick={() => setPage("connect")}
          >
            <Code2 size={17} />
            接入
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <select
              aria-label="当前研究项目"
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="all">全部研究项目</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="top-actions">
            <div className="instrument-status">
              <span>
                CPU <b>{(system.cpu_percent || 0).toFixed(0)}%</b>
              </span>
              <span>
                内存 <b>{(system.memory_percent || 0).toFixed(0)}%</b>
              </span>
            </div>
            <span className="connection">
              <span className={error ? "offline-dot" : "live-dot"} />
              {error ? "离线" : ""}
            </span>
            <span className="top-divider" />
            <button
              className={cls("live-switch", live && "on")}
              onClick={() => setLive(!live)}
            >
              <span />
              实时更新
            </button>
            <button
              className="icon-button"
              aria-label="刷新数据"
              onClick={() => act(refresh, "数据已刷新")}
            >
              <RefreshCw size={15} className={busy ? "spin" : ""} />
            </button>
          </div>
        </header>
        <main key={page}>
          {error && (
            <div className="error-banner">
              <Info size={16} />
              <span>{error}</span>
              <button onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <h1>
                {page === "overview"
                  ? "指标"
                  : page === "runs"
                    ? "实验"
                    : page === "compare"
                      ? "对比"
                      : page === "configs"
                        ? "配置"
                        : page === "sweeps"
                          ? "搜索"
                          : page === "files"
                            ? "文件"
                            : "接入"}
              </h1>
            </div>
            <div className="heading-actions">
              {page !== "connect" && (
                <button
                  className="button secondary"
                  onClick={() => setModal("import")}
                >
                  <Upload size={14} />
                  导入
                </button>
              )}
              <button
                className="button primary"
                onClick={() => setModal(page === "sweeps" ? "sweep" : "new")}
              >
                <Plus size={15} />
                {page === "sweeps" ? "新建搜索" : "新建配置"}
              </button>
            </div>
          </div>

          {page === "overview" && (
            <>
              <div className="metrics-toolbar">
                <div className="search-field">
                  <Search size={16} />
                  <input
                    aria-label="筛选指标"
                    placeholder="筛选指标"
                    value={metricQuery}
                    onChange={(e) => setMetricQuery(e.target.value)}
                  />
                  {metricQuery && (
                    <button
                      aria-label="清空指标筛选"
                      onClick={() => setMetricQuery("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <label>
                  平滑{" "}
                  <input
                    type="range"
                    aria-label="曲线平滑"
                    min="0"
                    max="0.95"
                    step="0.05"
                    value={smooth}
                    onChange={(e) => setSmooth(+e.target.value)}
                  />
                  <span className="mono">{smooth.toFixed(2)}</span>
                </label>
                <button
                  className={cls("tiny", logScale && "active")}
                  onClick={() => setLogScale(!logScale)}
                >
                  对数轴
                </button>
                {axisControl()}
                <button className="tiny" onClick={saveView}>
                  保存视图
                </button>
              </div>
              <div className="metric-grid">
                {deckMetrics.map((tag) => (
                  <section className="panel metric-card" key={tag}>
                    <div className="panel-head">
                      <h2 title={tag}>
                        {metricLabel(tag)
                          .replace(" · Epoch", "")
                          .replace(" · Step", "")}
                      </h2>
                      <button
                        className="icon-button"
                        title="对比"
                        aria-label={`对比 ${tag}`}
                        onClick={() => {
                          setSelected(chartRuns.map((r) => r.id));
                          setMetric(tag);
                          setPage("compare");
                        }}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </div>
                    <Curves
                      runs={chartRuns}
                      metric={tag}
                      histories={deckHistory[tag] || {}}
                      smoothing={smooth}
                      log={logScale}
                      axis={axis}
                      height={300}
                    />
                  </section>
                ))}
              </div>
              {!deckMetrics.length && (
                <Empty
                  title={runs.length ? "无匹配指标" : "暂无指标"}
                  action={() => setModal("import")}
                  button="导入"
                />
              )}
            </>
          )}

          {page === "runs" && (
            <>
              <div className="filterbar">
                <div className="search-field">
                  <Search size={15} />
                  <input
                    aria-label="搜索实验"
                    placeholder="搜索实验名称、参数或笔记…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button onClick={() => setQuery("")}>
                      <X size={13} />
                    </button>
                  )}
                </div>
                <select
                  aria-label="筛选项目"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                >
                  <option value="all">全部项目</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="筛选状态"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="all">全部状态</option>
                  <option value="RUNNING">运行中</option>
                  <option value="FINISHED">已完成</option>
                  <option value="FAILED">失败</option>
                  <option value="KILLED">已停止 / 草稿</option>
                </select>
                <select
                  aria-label="筛选分组"
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                >
                  <option value="">全部分组</option>
                  {allGroups.map((group) => (
                    <option key={group}>{group}</option>
                  ))}
                </select>
                <select
                  aria-label="筛选标签"
                  value={labelFilter}
                  onChange={(e) => setLabelFilter(e.target.value)}
                >
                  <option value="">全部标签</option>
                  {allLabels.map((label) => (
                    <option key={label}>{label}</option>
                  ))}
                </select>
                <select
                  aria-label="排序方式"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="new">最近创建</option>
                  <option value="loss">验证损失升序</option>
                  <option value="name">名称排序</option>
                </select>
                <button
                  className={cls("icon-button", archive && "pinned")}
                  title="显示已归档"
                  onClick={() => setArchive(!archive)}
                >
                  <FolderOpen size={16} />
                </button>
              </div>
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2>{currentProject}</h2>
                    <span className="muted">{filtered.length} 次实验</span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => download(filtered.map((r) => r.id))}
                  >
                    <Download size={13} />
                    导出
                  </button>
                </div>
                {runTable()}
              </section>
            </>
          )}

          {page === "compare" && (
            <>
              <div className="compare-picker">
                <div>
                  <span className="section-index">已选实验</span>
                  <span className="muted">{chosen.length} / 6</span>
                </div>
                <div className="compare-chips">
                  {chosen.map((r, i) => (
                    <button
                      key={r.id}
                      style={{ borderColor: colors[i % colors.length] }}
                      onClick={() => toggle(r.id)}
                    >
                      <span
                        className="run-dot"
                        style={{ background: colors[i % colors.length] }}
                      />
                      {r.name}
                      <X size={12} />
                    </button>
                  ))}
                  <select
                    aria-label="加入对比"
                    value=""
                    onChange={(e) => toggle(e.target.value)}
                  >
                    <option value="">＋ 加入实验</option>
                    {runs
                      .filter((r) => !selected.includes(r.id))
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              {chosen.length ? (
                <>
                  {new Set(chosen.map((r) => r.project_id)).size > 1 && (
                    <div className="info-strip">
                      <Info size={16} />
                      <span>跨项目对比：请确认数据划分与指标一致。</span>
                    </div>
                  )}
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>指标曲线对比</h2>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => download(selected, "metrics")}
                      >
                        <Download size={13} />
                        导出
                      </button>
                    </div>
                    {metricControls()}
                    <Curves
                      runs={chosen}
                      metric={actualMetric}
                      histories={histories}
                      smoothing={smooth}
                      log={logScale}
                      axis={axis}
                      height={340}
                    />
                  </section>
                  <div className="two-column">
                    <section className="panel">
                      <div className="panel-head">
                        <h2>超参数平行坐标</h2>
                      </div>
                      <Parallel runs={chosen} />
                    </section>
                    <section className="panel">
                      <div className="panel-head">
                        <h2>参数与结果差异</h2>
                        <button
                          className="text-button"
                          onClick={() => download(selected, "config")}
                        >
                          <Download size={13} />
                          配置
                        </button>
                      </div>
                      <MetricResults
                        runs={chosen}
                        histories={histories}
                        metric={actualMetric}
                      />
                      <ParameterTable runs={chosen} />
                    </section>
                  </div>
                </>
              ) : (
                <Empty
                  title="选择实验"
                  action={() => setPage("runs")}
                  button="实验"
                />
              )}
            </>
          )}

          {page === "configs" && (
            <div className="config-layout">
              <section className="panel template-list">
                <div className="panel-head">
                  <h2>配置版本</h2>
                  <button
                    className="icon-button"
                    aria-label="创建空白配置"
                    onClick={() => {
                      setConfigId(null);
                      setConfigName("新配置");
                      setConfigText("{}");
                    }}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {templates.length ? (
                  templates.map((t) => (
                    <button
                      key={t.id}
                      className={cls(
                        "template-item",
                        configId === t.id && "active",
                      )}
                      onClick={() => {
                        setConfigId(t.id);
                        setConfigName(t.name);
                        setConfigText(JSON.stringify(t.config, null, 2));
                      }}
                    >
                      <span className="template-number mono">
                        {String(t.id)}
                      </span>
                      <span>
                        <strong>{t.name}</strong>
                        <small>
                          {t.project} · {Object.keys(t.config).length} 个参数
                        </small>
                        <em>{date(t.created * 1000)}</em>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  ))
                ) : (
                  <div className="empty small">暂无配置</div>
                )}
              </section>
              <section className="panel config-editor">
                <div className="panel-head">
                  <div>
                    <h2>{configId ? "编辑已有版本" : "创建配置"}</h2>
                    <span className="badge">JSON</span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => copy(configText)}
                  >
                    <Copy size={13} />
                    复制
                  </button>
                </div>
                <div className="editor-body">
                  <label className="field">
                    名称
                    <input
                      value={configName}
                      onChange={(e) => setConfigName(e.target.value)}
                    />
                  </label>
                  <div className="editor-label">
                    <span>超参数</span>
                  </div>
                  <textarea
                    aria-label="超参数 JSON 编辑器"
                    className="code-editor"
                    spellCheck={false}
                    value={configText}
                    onChange={(e) => setConfigText(e.target.value)}
                  />
                  <div className="editor-foot">
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() =>
                        act(
                          () =>
                            post("/templates", {
                              name: configName,
                              project: defaultProject,
                              config: JSON.parse(configText),
                            }),
                          "配置已保存为新版本",
                        )
                      }
                    >
                      <Plus size={14} />
                      保存版本
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}

          {page === "sweeps" && (
            <>
              {studies.length ? (
                studies.map((s) => (
                  <section className="panel study-card" key={s.name}>
                    <div className="panel-head">
                      <div>
                        <span className="study-icon">
                          <BarChart3 size={18} />
                        </span>
                        <h2>{s.name}</h2>
                        <span
                          className={cls(
                            "status",
                            s.status === "RUNNING" && "running",
                          )}
                        >
                          <i />
                          {(
                            {
                              WAITING: "待执行",
                              RUNNING: "运行中",
                              FINISHED: "已完成",
                              STOPPED: "已停止",
                              FAILED: "失败",
                            } as Record<string, string>
                          )[s.status] || s.status}
                        </span>
                      </div>
                      <div className="study-actions">
                        {s.status === "RUNNING" ? (
                          <button
                            className="button secondary"
                            onClick={() =>
                              act(
                                () =>
                                  post(
                                    `/studies/${encodeURIComponent(s.name)}/stop`,
                                  ),
                                "将在当前更新点停止",
                              )
                            }
                          >
                            <Square size={12} />
                            停止
                          </button>
                        ) : s.objective === "example" &&
                          s.completed < s.trials ? (
                          <button
                            className="button primary"
                            onClick={() =>
                              act(
                                () =>
                                  post(
                                    `/studies/${encodeURIComponent(s.name)}/start`,
                                  ),
                                "搜索已开始",
                              )
                            }
                          >
                            <Play size={13} />
                            开始搜索
                          </button>
                        ) : null}
                        <button
                          className="icon-button"
                          title="复制搜索配置"
                          onClick={() => copy(JSON.stringify(s.space, null, 2))}
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="study-summary">
                      <div>
                        <span>搜索策略</span>
                        <strong>{s.sampler.toUpperCase()}</strong>
                      </div>
                      <div>
                        <span>实验进度</span>
                        <strong>
                          {s.completed}
                          <small> / {s.trials}</small>
                        </strong>
                      </div>
                      <div>
                        <span>最优目标值</span>
                        <strong className="red mono">
                          {numeric(s.best_value ?? undefined)}
                        </strong>
                      </div>
                      <div>
                        <span>训练来源</span>
                        <strong className="normal">
                          {s.objective === "example"
                            ? "线性分类 · 功能示例"
                            : "自定义训练函数"}
                        </strong>
                      </div>
                    </div>
                    <div className="progress-track">
                      <span
                        style={{ width: `${(s.completed / s.trials) * 100}%` }}
                      />
                    </div>
                    {s.objective === "external" && (
                      <div className="worker-command">
                        <Terminal size={15} />
                        <code>
                          runboard worker --study "{s.name}" --objective
                          train:objective
                        </code>
                        <button
                          onClick={() =>
                            copy(
                              `runboard worker --study "${s.name}" --objective train:objective`,
                            )
                          }
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                    )}
                    <details>
                      <summary>
                        试验记录 <ChevronDown size={13} />
                      </summary>
                      <pre className="best-config">
                        {JSON.stringify(s.best_params, null, 2)}
                      </pre>
                      <table>
                        <thead>
                          <tr>
                            <th>试验</th>
                            <th>状态</th>
                            <th>参数</th>
                            <th>目标值</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {s.trial_data.map((t) => (
                            <tr key={t.number}>
                              <td className="mono">#{t.number + 1}</td>
                              <td>
                                {
                                  (
                                    {
                                      COMPLETE: "已完成",
                                      RUNNING: "运行中",
                                      PRUNED: "已剪枝 / 停止",
                                      FAIL: "失败",
                                      WAITING: "等待",
                                    } as Record<string, string>
                                  )[t.state]
                                }
                              </td>
                              <td className="mono">
                                {Object.entries(t.params)
                                  .map(([k, v]) => `${k}=${numeric(v)}`)
                                  .join(" · ")}
                              </td>
                              <td className="mono">
                                {numeric(t.value ?? undefined)}
                              </td>
                              <td>
                                {t.run_id && (
                                  <button
                                    className="text-button"
                                    onClick={() => setDetail({ id: t.run_id! })}
                                  >
                                    查看实验 <ArrowUpRight size={13} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  </section>
                ))
              ) : (
                <Empty
                  title="暂无搜索"
                  action={() => setModal("sweep")}
                  button="创建搜索任务"
                />
              )}
            </>
          )}

          {page === "files" && (
            <section className="panel">
              <div className="panel-head">
                <h2>实验产物</h2>
                <select
                  aria-label="选择产物所属实验"
                  value={fileRun}
                  onChange={(e) => setFileRun(e.target.value)}
                >
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              {fileRun && (
                <Artifacts
                  rid={fileRun}
                  refreshKey={updated}
                  onError={setError}
                />
              )}
            </section>
          )}

          {page === "connect" && (
            <Connect home={meta?.home || ""} copy={copy} />
          )}
        </main>
      </div>

      {selected.length > 0 && page === "runs" && (
        <div className="selection-bar">
          <span className="selection-count">{selected.length}</span>
          <span>次实验已选</span>
          <button onClick={() => setPage("compare")}>
            <GitCompareArrows size={15} />
            对比实验
          </button>
          <button onClick={() => download(selected)}>
            <Download size={14} />
            导出
          </button>
          <button
            className="icon-button"
            onClick={() => setSelected([])}
            aria-label="清空选择"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast">
          <Check size={16} />
          {notice}
        </div>
      )}
      {activeRun && (
        <RunDetail
          key={activeRun.id}
          run={activeRun}
          initialTab={detail?.tab}
          close={() => setDetail(null)}
          refresh={refresh}
          toast={toast}
          onError={setError}
          onTemplate={() => {
            setConfigId(null);
            setConfigName(activeRun.name + " · 配置");
            setConfigText(
              JSON.stringify(
                Object.keys(activeRun.config).length
                  ? activeRun.config
                  : activeRun.params,
                null,
                2,
              ),
            );
            setDetail(null);
            setPage("configs");
          }}
        />
      )}
      {modal && (
        <Dialog
          title={
            modal === "import"
              ? "导入 TensorBoard 日志"
              : modal === "project"
                ? "创建研究项目"
                : modal === "sweep"
                  ? "创建超参数搜索"
                  : "新建配置"
          }
          close={() => setModal(null)}
        >
          <ActionForm
            kind={modal}
            project={defaultProject}
            projects={projects}
            logs={meta?.suggested_logs || []}
            busy={busy}
            submit={async (body) => {
              setBusy(true);
              try {
                if (modal === "import") {
                  const r = await post<{ runs: { new_points: number }[] }>(
                    "/import",
                    body,
                  );
                  toast(
                    `已导入 ${r.runs.length} 次实验，新增 ${r.runs.reduce((n, r) => n + r.new_points, 0)} 个指标点`,
                  );
                } else if (modal === "sweep") {
                  await post("/studies", body);
                  setPage("sweeps");
                  toast("搜索任务已创建");
                } else if (modal === "project") {
                  await post("/projects", body);
                  toast("项目已创建");
                } else {
                  await post("/templates", {
                    name: (body as { name: string }).name,
                    project: (body as { project: string }).project,
                    config: (body as { config: unknown }).config,
                  });
                  setPage("configs");
                  toast("实验配置已保存，可以接入训练使用");
                }
                setModal(null);
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            onProject={() => setModal("project")}
          />
        </Dialog>
      )}
    </div>
  );
}

function Status({ run }: { run: Run }) {
  return (
    <span
      className={cls(
        "status",
        run.status === "RUNNING" && "running",
        run.status === "FAILED" && "failed",
        run.tags["runboard.draft"] === "true" && "draft",
      )}
    >
      <i />
      {statusLabel(run)}
    </span>
  );
}
function Empty({
  title,
  text,
  action,
  button,
}: {
  title: string;
  text?: string;
  action?: () => void;
  button?: string;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol">
        <Activity size={23} />
      </span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && (
        <button className="button secondary" onClick={action}>
          {button}
          <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const { leaving, dismiss } = useDismiss(close);
  return (
    <div
      className={`modal-backdrop ${leaving ? "leaving" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-head">
          <div>
            <span className="red-square" />
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={dismiss}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function ParameterTable({ runs }: { runs: Run[] }) {
  const keys = [...new Set(runs.flatMap((r) => Object.keys(r.params)))];
  return (
    <div className="table-scroll parameter-table">
      <table>
        <thead>
          <tr>
            <th>参数</th>
            {runs.map((r, i) => (
              <th key={r.id}>
                <span
                  className="run-dot"
                  style={{ background: colors[i % colors.length] }}
                />
                {r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr
              className={
                new Set(runs.map((r) => r.params[k])).size > 1
                  ? "different"
                  : ""
              }
              key={k}
            >
              <td>{metricLabel(k)}</td>
              {runs.map((r) => (
                <td key={r.id} className="mono">
                  {r.params[k] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricResults({
  runs,
  histories,
  metric,
}: {
  runs: Run[];
  histories: Record<string, Point[]>;
  metric: string;
}) {
  const [mode, setMode] = useState("last"),
    [direction, setDirection] = useState("min"),
    [baseline, setBaseline] = useState(runs[0]?.id || "");
  const value = (run: Run) => {
    const points = histories[run.id] || [];
    return points.length
      ? mode === "last"
        ? points.at(-1)!.value
        : points.reduce(
            (best, p) =>
              direction === "min"
                ? Math.min(best, p.value)
                : Math.max(best, p.value),
            points[0].value,
          )
      : undefined;
  };
  const base = runs.find((run) => run.id === baseline) || runs[0],
    reference = base ? value(base) : undefined;
  return (
    <div className="metric-results">
      <div className="results-controls">
        <select
          aria-label="结果汇总"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="last">最近值</option>
          <option value="best">最优值</option>
        </select>
        <select
          aria-label="指标方向"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        >
          <option value="min">越小越好</option>
          <option value="max">越大越好</option>
        </select>
        <select
          aria-label="基线实验"
          value={base?.id || ""}
          onChange={(e) => setBaseline(e.target.value)}
        >
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.name}
            </option>
          ))}
        </select>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>实验</th>
              <th>{metricLabel(metric)}</th>
              <th>相对基线</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const current = value(run),
                delta =
                  reference !== undefined &&
                  reference !== 0 &&
                  current !== undefined
                    ? ((current - reference) / Math.abs(reference)) * 100
                    : undefined;
              return (
                <tr key={run.id}>
                  <td>{run.name}</td>
                  <td className="mono">{numeric(current)}</td>
                  <td className="mono">
                    {delta === undefined
                      ? "—"
                      : (delta > 0 ? "+" : "") + delta.toFixed(2) + "%"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActionForm({
  kind,
  project,
  projects,
  logs,
  busy,
  submit,
  onProject,
}: {
  kind: Exclude<Modal, null>;
  project: string;
  projects: Project[];
  logs: string[];
  busy: boolean;
  submit: (body: unknown) => void;
  onProject: () => void;
}) {
  const [name, setName] = useState(
      kind === "sweep"
        ? "学习率探索-" +
            new Date().toISOString().slice(11, 16).replace(":", "")
        : "GATv2 · 新实验",
    ),
    [proj, setProj] = useState(project),
    [path, setPath] = useState(logs[0] || ""),
    [text, setText] = useState(
      JSON.stringify(kind === "sweep" ? exampleSpace : exampleConfig, null, 2),
    ),
    [sampler, setSampler] = useState("tpe"),
    [trials, setTrials] = useState(6),
    [objective, setObjective] = useState("example"),
    [direction, setDirection] = useState("minimize"),
    [formError, setFormError] = useState("");
  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body =
        kind === "import"
          ? { path, project: proj }
          : kind === "project"
            ? { name }
            : kind === "sweep"
              ? {
                  name,
                  project: proj,
                  sampler,
                  trials,
                  objective,
                  direction,
                  seed: 42,
                  space: JSON.parse(text),
                }
              : { name, project: proj, config: JSON.parse(text) };
      submit(body);
    } catch {
      setFormError("JSON 格式有误，请检查引号、逗号和括号。");
    }
  };
  return (
    <form className="action-form" onSubmit={handle}>
      {kind === "import" ? (
        <>
          <label className="field">
            日志目录
            <input
              required
              placeholder="例如 D:/research/lightning_logs"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </label>
        </>
      ) : (
        <label className="field">
          {kind === "project" ? "项目名称" : kind === "sweep" ? "名称" : "名称"}
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      {kind !== "project" && (
        <label className="field">
          项目
          <div className="inline-field">
            <input
              list="projects-list"
              required
              value={proj}
              onChange={(e) => setProj(e.target.value)}
            />
            <datalist id="projects-list">
              {projects.map((p) => (
                <option key={p.id}>{p.name}</option>
              ))}
            </datalist>
            <button
              type="button"
              className="icon-button"
              title="新建项目"
              onClick={onProject}
            >
              <Plus size={17} />
            </button>
          </div>
        </label>
      )}
      {kind === "sweep" && (
        <>
          <div className="form-row">
            <label className="field">
              搜索策略
              <select
                value={sampler}
                onChange={(e) => {
                  setSampler(e.target.value);
                  if (e.target.value === "grid")
                    setText(
                      JSON.stringify(
                        {
                          learning_rate: {
                            type: "categorical",
                            choices: [0.01, 0.05, 0.1],
                          },
                          weight_decay: {
                            type: "categorical",
                            choices: [0, 0.001],
                          },
                        },
                        null,
                        2,
                      ),
                    );
                }}
              >
                <option value="tpe">TPE · 贝叶斯采样</option>
                <option value="random">随机搜索</option>
                <option value="grid">网格搜索</option>
              </select>
            </label>
            <label className="field">
              试验次数
              <input
                type="number"
                min="1"
                max="100"
                value={trials}
                onChange={(e) => setTrials(+e.target.value)}
              />
            </label>
          </div>
          <div className="form-row">
            <label className="field">
              训练来源
              <select
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
              >
                <option value="example">内置线性分类 · 功能示例</option>
                <option value="external">接入自己的训练函数</option>
              </select>
            </label>
            <label className="field">
              优化方向
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              >
                <option value="minimize">最小化目标值</option>
                <option value="maximize">最大化目标值</option>
              </select>
            </label>
          </div>
        </>
      )}
      {(kind === "sweep" || kind === "new") && (
        <label className="field">
          {kind === "sweep" ? "搜索空间" : "参数"}
          <textarea
            className="code-editor form-code"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      )}

      {formError && <p className="form-error">{formError}</p>}
      <div className="dialog-foot">
        <button disabled={busy} className="button primary" type="submit">
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : kind === "import" ? (
            <Upload size={14} />
          ) : (
            <Plus size={14} />
          )}{" "}
          {kind === "import"
            ? "开始导入"
            : kind === "sweep"
              ? "创建任务"
              : "保存"}
        </button>
      </div>
    </form>
  );
}

function Connect({ home, copy }: { home: string; copy: (s: string) => void }) {
  const [tab, setTab] = useState("lightning");
  const sdk = `from runboard import Run\n\nwith Run(\n    project="蛋白质设计",\n    name="GATv2-baseline",\n    server="http://127.0.0.1:7310",\n    config={"learning_rate": 0.001, "seed": 42},\n    group="baseline", labels=["GATv2"],\n    monitor_interval=10, record_environment=True,\n) as run:\n    for step, batch in enumerate(train_loader):\n        loss = train_step(batch)\n        run.log({"train/loss": float(loss)}, step=step)\n    run.artifact("best_model.pt", folder="checkpoints")`;
  const lightning = `from runboard.lightning import RunBoardLogger\nimport lightning as L\n\nlogger = RunBoardLogger(\n    project="蛋白质界面预测",\n    name="GATv2-baseline",\n    server="http://127.0.0.1:7310",\n    monitor_interval=10, record_environment=True,\n)\ntrainer = L.Trainer(max_epochs=20, logger=logger)\ntrainer.fit(model, datamodule=datamodule)`;
  const worker = `# train.py\ndef objective(config, run):\n    model = build_model(config)\n    for epoch in range(20):\n        train_loss = train_epoch(model, config)\n        val_loss = validate(model)\n        run.log({"train/loss": train_loss,\n                 "val/loss": val_loss}, step=epoch)\n    return val_loss\n\n# runboard worker --study 搜索名称 --objective train:objective`;
  const code = tab === "lightning" ? lightning : tab === "sdk" ? sdk : worker;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div className="connect-tabs">
            {[
              ["lightning", "Lightning"],
              ["sdk", "Python"],
              ["worker", "Worker"],
            ].map(([id, text]) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {text}
              </button>
            ))}
          </div>
          <button
            className="icon-button"
            title="复制"
            aria-label="复制代码"
            onClick={() => copy(code)}
          >
            <Copy size={17} />
          </button>
        </div>
        <pre className="integration-code">{code}</pre>
      </section>
      <div className="storage-path">
        <span>数据目录</span>
        <code>{home}</code>
        <button
          className="icon-button"
          title="复制"
          aria-label="复制数据目录"
          onClick={() => copy(home)}
        >
          <Copy size={15} />
        </button>
      </div>
    </>
  );
}
