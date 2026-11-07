import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ChevronRight,
  File,
  Folder,
  Upload,
} from "lucide-react";
import type { EChartsCoreOption } from "echarts/core";
import { api, colors } from "./data";
import { Chart } from "./Charts";

type Artifact = { path: string; is_dir: boolean; size: number | null };
type Preview = {
  path: string;
  text?: string;
  truncated?: boolean;
  option?: EChartsCoreOption;
};
const textFile = /\.(txt|log|csv|tsv|json|ya?ml|md|pdb|cif|sdf|py)$/i;
const imageFile = /\.(png|jpe?g|webp|gif)$/i;
const videoFile = /\.(mp4|webm)$/i;
const audioFile = /\.(mp3|wav|ogg)$/i;

export function Artifacts({
  rid,
  refreshKey,
  onError,
}: {
  rid: string;
  refreshKey?: unknown;
  onError: (text: string) => void;
}) {
  const [path, setPath] = useState(""),
    [files, setFiles] = useState<Artifact[]>([]),
    [preview, setPreview] = useState<Preview | null>(null),
    [uploading, setUploading] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    setPath("");
    setPreview(null);
  }, [rid]);
  useEffect(() => {
    let active = true;
    api<Artifact[]>(`/runs/${rid}/artifacts?path=${encodeURIComponent(path)}`)
      .then((rows) => {
        if (active) setFiles(rows);
      })
      .catch((e) => onError(e.message));
    return () => {
      active = false;
    };
  }, [rid, path, refreshKey, revision, onError]);
  const url = (file: string, extra = "") =>
    `/api/runs/${rid}/download?path=${encodeURIComponent(file)}${extra}`;
  async function open(file: Artifact) {
    if (file.is_dir) {
      setPath(file.path);
      setPreview(null);
      return;
    }
    if (textFile.test(file.path)) {
      try {
        const data = await api<{ text: string; truncated: boolean }>(
          `/runs/${rid}/download?path=${encodeURIComponent(file.path)}&preview=true`,
        );
        let option: EChartsCoreOption | undefined;
        if (
          file.path.startsWith("charts/") &&
          file.path.endsWith(".json") &&
          !data.truncated
        ) {
          const chart = JSON.parse(data.text);
          if (chart.runboard_chart === 1) option = chart.option;
        }
        setPreview({ path: file.path, ...data, option });
      } catch (error) {
        onError((error as Error).message);
      }
    } else if (
      imageFile.test(file.path) ||
      videoFile.test(file.path) ||
      audioFile.test(file.path)
    )
      setPreview({ path: file.path });
    else window.open(url(file.path), "_blank", "noopener");
  }
  async function upload(input: HTMLInputElement) {
    setUploading(true);
    try {
      for (const file of Array.from(input.files || [])) {
        const body = new FormData();
        body.append("file", file);
        body.append("folder", path);
        const response = await fetch(`/api/track/runs/${rid}/artifact`, {
          method: "POST",
          body,
        });
        if (!response.ok) throw new Error((await response.json()).detail);
      }
      setRevision((value) => value + 1);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setUploading(false);
      input.value = "";
    }
  }
  return (
    <div className="artifact-browser">
      <div className="file-breadcrumb">
        <button
          onClick={() => {
            setPath("");
            setPreview(null);
          }}
        >
          <Folder size={14} />
          根目录
        </button>
        {path && (
          <>
            <ChevronRight size={12} />
            <span>{path}</span>
            <button
              className="text-button"
              onClick={() => {
                setPath(path.split("/").slice(0, -1).join("/"));
                setPreview(null);
              }}
            >
              上级
            </button>
          </>
        )}
        <label className="button secondary upload-control">
          <Upload size={14} />
          {uploading ? "上传中" : "上传"}
          <input
            aria-label="上传文件"
            type="file"
            multiple
            disabled={uploading}
            onChange={(e) => upload(e.currentTarget)}
          />
        </label>
      </div>
      {preview && (
        <div className="file-preview">
          <div className="preview-head">
            <strong>{preview.path.split("/").at(-1)}</strong>
            <button onClick={() => setPreview(null)}>关闭</button>
          </div>
          {preview.option ? (
            <Chart
              height={320}
              option={{
                ...preview.option,
                tooltip: { renderMode: "richText" },
              }}
            />
          ) : preview.path.toLowerCase().endsWith(".pdb") && preview.text ? (
            <ProteinTrace text={preview.text} />
          ) : preview.text !== undefined ? (
            <pre>{preview.text}</pre>
          ) : imageFile.test(preview.path) ? (
            <img alt={preview.path} src={url(preview.path, "&inline=true")} />
          ) : videoFile.test(preview.path) ? (
            <video controls src={url(preview.path, "&inline=true")} />
          ) : (
            <audio controls src={url(preview.path, "&inline=true")} />
          )}
          {preview.truncated && <span className="muted">前 1 MB</span>}
        </div>
      )}
      {files.some((file) => imageFile.test(file.path)) && (
        <div className="artifact-gallery">
          {files
            .filter((file) => imageFile.test(file.path))
            .slice(0, 8)
            .map((file) => (
              <button key={file.path} onClick={() => open(file)}>
                <img
                  loading="lazy"
                  alt={file.path}
                  src={url(file.path, "&inline=true")}
                />
                <span>{file.path.split("/").at(-1)}</span>
              </button>
            ))}
        </div>
      )}
      {files.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>文件</th>
                <th>大小</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.path}>
                  <td>
                    <button className="file-name" onClick={() => open(file)}>
                      {file.is_dir ? <Folder size={16} /> : <File size={16} />}{" "}
                      {file.path.split("/").at(-1)}
                    </button>
                  </td>
                  <td className="mono muted">
                    {file.is_dir
                      ? "—"
                      : `${((file.size || 0) / 1024).toFixed(1)} KB`}
                  </td>
                  <td>
                    {!file.is_dir && (
                      <a className="text-button" href={url(file.path)}>
                        <ArrowDownToLine size={14} />
                        下载
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty small">暂无文件</div>
      )}
    </div>
  );
}

function ProteinTrace({ text }: { text: string }) {
  const [angles, setAngles] = useState([0.4, -0.3]),
    [zoom, setZoom] = useState(1),
    [drag, setDrag] = useState<number[] | null>(null);
  const atoms = text
    .split("ENDMDL")[0]
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("ATOM  ") &&
        line.slice(12, 16).trim() === "CA" &&
        [" ", "A"].includes(line[16]),
    )
    .map((line) => ({
      chain: line[21],
      p: [
        Number(line.slice(30, 38)),
        Number(line.slice(38, 46)),
        Number(line.slice(46, 54)),
      ],
    }))
    .filter((atom) => atom.p.every(Number.isFinite));
  if (!atoms.length) return <pre>{text}</pre>;
  const center = [0, 1, 2].map(
    (i) => atoms.reduce((sum, atom) => sum + atom.p[i], 0) / atoms.length,
  );
  const extent = Math.max(
    1,
    ...atoms.map((atom) =>
      Math.hypot(...atom.p.map((value, i) => value - center[i])),
    ),
  );
  const chains = [...new Set(atoms.map((atom) => atom.chain))];
  const projected = atoms.map((atom) => {
    const [x, y, z] = atom.p.map((value, i) => value - center[i]),
      a = x * Math.cos(angles[0]) + z * Math.sin(angles[0]),
      b = -x * Math.sin(angles[0]) + z * Math.cos(angles[0]);
    return {
      ...atom,
      x: 300 + (a / extent) * 145 * zoom,
      y:
        180 +
        ((y * Math.cos(angles[1]) - b * Math.sin(angles[1])) / extent) *
          145 *
          zoom,
    };
  });
  return (
    <div className="protein-trace">
      <div className="trace-tools">
        <span>Cα 骨架 · {atoms.length}</span>
        <input
          aria-label="结构缩放"
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={zoom}
          onChange={(e) => setZoom(+e.target.value)}
        />
        <button
          onClick={() => {
            setAngles([0.4, -0.3]);
            setZoom(1);
          }}
        >
          重置
        </button>
      </div>
      <svg
        aria-label="可旋转蛋白质骨架"
        viewBox="0 0 600 360"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag([e.clientX, e.clientY]);
        }}
        onPointerUp={() => setDrag(null)}
        onPointerMove={(e) => {
          if (drag) {
            setAngles((old) => [
              old[0] + (e.clientX - drag[0]) * 0.012,
              old[1] + (e.clientY - drag[1]) * 0.012,
            ]);
            setDrag([e.clientX, e.clientY]);
          }
        }}
      >
        {projected.slice(1).map((atom, i) => {
          const previous = projected[i];
          return atom.chain === previous.chain &&
            Math.hypot(...atom.p.map((value, j) => value - previous.p[j])) <
              6 ? (
            <line
              key={i}
              x1={previous.x}
              y1={previous.y}
              x2={atom.x}
              y2={atom.y}
              stroke={colors[chains.indexOf(atom.chain) % colors.length]}
              strokeWidth="2.5"
            />
          ) : null;
        })}
      </svg>
    </div>
  );
}
