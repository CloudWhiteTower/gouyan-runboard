import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import {
  LineChart,
  ScatterChart,
  ParallelChart,
  BarChart,
  HeatmapChart,
} from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ParallelComponent,
  ToolboxComponent,
  VisualMapComponent,
  TitleComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
import { colors, metricLabel, numeric, Run, Point } from "./data";

echarts.use([
  LineChart,
  ScatterChart,
  ParallelChart,
  BarChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ParallelComponent,
  ToolboxComponent,
  VisualMapComponent,
  TitleComponent,
  SVGRenderer,
]);
const font =
  'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif';
export function Chart({
  option,
  height = 280,
}: {
  option: EChartsCoreOption;
  height?: number;
}) {
  const div = useRef<HTMLDivElement>(null),
    chart = useRef<echarts.ECharts>(null);
  useEffect(() => {
    chart.current = echarts.init(div.current!, undefined, { renderer: "svg" });
    chart.current.on("finished", () => {
      if (div.current) div.current.dataset.chartState = "ready";
    });
    const observer = new ResizeObserver(() => chart.current?.resize());
    observer.observe(div.current!);
    document.fonts.ready.then(() => chart.current?.resize());
    return () => {
      observer.disconnect();
      chart.current?.dispose();
    };
  }, []);
  useEffect(() => {
    if (div.current) div.current.dataset.chartState = "updating";
    chart.current?.setOption(
      {
        color: colors,
        animationDuration: 220,
        animationDurationUpdate: 300,
        animationEasing: "cubicOut",
        animationEasingUpdate: "cubicOut",
        toolbox: {
          right: 18,
          top: 6,
          itemSize: 15,
          feature: {
            saveAsImage: {
              type: "svg",
              title: "下载矢量图",
              name: "RunBoard-实验图表",
            },
            restore: { title: "重置视图" },
          },
        },
        textStyle: { fontFamily: font, fontSize: 13, color: "#586252" },
        ...option,
        animation: !window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches,
      },
      { replaceMerge: ["series"] },
    );
  }, [option]);
  return (
    <div
      ref={div}
      style={{ height, width: "100%" }}
      role="img"
      aria-label="可交互实验图表"
    />
  );
}
export type TimeAxis = "step" | "relative" | "wall";
export function Curves({
  runs,
  metric,
  histories,
  smoothing = 0,
  height = 280,
  log = false,
  axis = "step",
}: {
  runs: Run[];
  metric: string;
  histories: Record<string, Point[]>;
  smoothing?: number;
  height?: number;
  log?: boolean;
  axis?: TimeAxis;
}) {
  const series = runs
    .filter((r) => r.metrics[metric] !== undefined)
    .map((r, i) => {
      let smoothed: number | undefined;
      const points = histories[r.id] || [],
        start = points.length
          ? points.reduce(
              (first, p) => Math.min(first, p.timestamp),
              points[0].timestamp,
            )
          : r.start_time;
      return {
        name: r.name,
        type: "line",
        showSymbol: points.length === 1,
        symbolSize: 5,
        connectNulls: false,
        lineStyle: { width: 2.3, color: colors[i % colors.length] },
        itemStyle: { color: colors[i % colors.length] },
        data: points.map((p) => {
          smoothed =
            smoothed === undefined
              ? p.value
              : smoothing * smoothed + (1 - smoothing) * p.value;
          return [
            axis === "relative"
              ? (p.timestamp - start) / 1000
              : axis === "wall"
                ? p.timestamp
                : p.step,
            log && smoothed <= 0 ? null : smoothed,
          ];
        }),
      };
    });
  return (
    <Chart
      height={height}
      option={{
        tooltip: {
          trigger: "axis",
          backgroundColor: "#242823",
          borderWidth: 0,
          textStyle: { color: "#fff", fontSize: 14 },
          valueFormatter: (v: unknown) => numeric(v),
        },
        legend: {
          show: series.length > 1,
          bottom: 6,
          type: "scroll",
          tooltip: { show: true },
          formatter: (name: string) =>
            name.length > 20 ? name.slice(0, 10) + "…" + name.slice(-5) : name,
          icon: "roundRect",
          itemWidth: 12,
          itemHeight: 3,
          textStyle: { fontFamily: font, fontSize: 13, color: "#586252" },
        },
        grid: {
          left: 62,
          right: 46,
          top: 42,
          bottom: series.length > 1 ? 70 : 42,
        },
        xAxis: {
          type: axis === "wall" ? "time" : "value",
          name: axis === "relative" ? "秒" : axis === "wall" ? "时间" : "步数",
          nameLocation: "end",
          nameTextStyle: { color: "#687064", fontSize: 13 },
          axisLabel: { fontSize: 13, color: "#687064", hideOverlap: true },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          min: axis === "wall" ? undefined : 0,
        },
        yAxis: {
          type: log ? "log" : "value",
          scale: true,
          axisLabel: {
            fontSize: 13,
            color: "#687064",
            formatter: (v: number) => numeric(v),
          },
          splitLine: { lineStyle: { color: "#e9e9e1", type: "dashed" } },
          name: "",
        },
        dataZoom: [{ type: "inside", filterMode: "none" }],
        series,
      }}
    />
  );
}
export function Parallel({ runs }: { runs: Run[] }) {
  const params = [...new Set(runs.flatMap((r) => Object.keys(r.params)))]
    .filter((k) =>
      runs.every(
        (r) =>
          r.params[k] !== undefined && Number.isFinite(Number(r.params[k])),
      ),
    )
    .slice(0, 5);
  const metric = runs.some((r) => r.metrics["val/loss"] !== undefined)
    ? "val/loss"
    : Object.keys(runs[0]?.metrics || {}).find(
        (k) => !k.startsWith("system/") && k !== "epoch",
      );
  const dims = [...params, ...(metric ? [metric] : [])];
  if (dims.length < 2) return <div className="empty small">暂无可比参数</div>;
  return (
    <Chart
      height={270}
      option={{
        parallel: {
          left: 55,
          right: 55,
          top: 32,
          bottom: 30,
          parallelAxisDefault: {
            type: "value",
            nameLocation: "end",
            nameTextStyle: { color: "#586252", fontFamily: font, fontSize: 13 },
            axisLine: { lineStyle: { color: "#d8dacf" } },
            axisTick: { show: false },
            axisLabel: { fontSize: 13, color: "#687064" },
          },
        },
        parallelAxis: dims.map((k, i) => ({
          dim: i,
          name: metricLabel(k),
          type: "value",
          scale: true,
        })),
        tooltip: {},
        series: runs.map((r, i) => ({
          type: "parallel",
          lineStyle: {
            width: 2,
            opacity: 0.65,
            color: colors[i % colors.length],
          },
          data: [
            [
              ...params.map((k) => Number(r.params[k])),
              ...(metric ? [r.metrics[metric] ?? null] : []),
            ],
          ],
        })),
      }}
    />
  );
}
