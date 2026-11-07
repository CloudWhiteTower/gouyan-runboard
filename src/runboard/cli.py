"""One command to start the packaged local dashboard."""

import argparse
import importlib
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        prog="runboard", description="构研 · 中文实验监控器"
    )
    parser.add_argument("--home", help="实验数据库和文件目录，默认 ~/.runboard")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="启动中文网页看板")
    serve.add_argument("--port", type=int, default=7310)
    serve.add_argument(
        "--workspace",
        default=str(Path.cwd()),
        help="允许导入 TensorBoard 日志的工作目录",
    )
    imp = sub.add_parser("import-tensorboard", help="导入已有 TensorBoard 日志")
    imp.add_argument("path")
    imp.add_argument("--project", default="蛋白质界面预测")
    worker = sub.add_parser(
        "worker", help="执行搜索任务；objective 函数接收 (config, run)，返回目标指标"
    )
    worker.add_argument("--study", required=True)
    worker.add_argument("--objective", required=True)
    example = sub.add_parser(
        "example", help="运行真实的小型 CPU 分类训练，验证监控功能"
    )
    example.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()
    if args.home:
        os.environ["RUNBOARD_HOME"] = str(Path(args.home).resolve())
    from .store import Store

    store = Store()
    if args.command == "serve":
        import uvicorn
        from .api import create_app

        print(
            f"\n构研 RunBoard\n浏览器打开：http://127.0.0.1:{args.port}\n数据目录：{store.home}\n"
        )
        uvicorn.run(
            create_app(home=store.home, workspace=args.workspace),
            host="127.0.0.1",
            port=args.port,
            log_level="warning",
        )
    elif args.command == "import-tensorboard":
        from .importer import import_tensorboard

        print(import_tensorboard(store, args.path, args.project))
    elif args.command == "worker":
        from .sweeps import execute_study

        module, function = args.objective.split(":", 1)
        execute_study(
            store, args.study, getattr(importlib.import_module(module), function)
        )
    else:
        from . import Run
        from .sweeps import train_example

        for i in range(args.runs):
            config = {
                "learning_rate": [0.025, 0.08, 0.2][i % 3],
                "weight_decay": 0.001,
                "epochs": 60,
                "seed": 42,
                "model": "线性分类器（监控示例）",
            }
            with Run(
                "监控功能示例",
                f"线性分类 · LR {config['learning_rate']}",
                config,
                home=store.home,
                tags={"runboard.source": "example"},
            ) as run:
                train_example(run, config)
                run.note(
                    "合成分类数据上的真实梯度下降，仅用于监控功能验收。训练/验证为固定的 192/48 划分。"
                )
        print("示例训练完成。")


if __name__ == "__main__":
    main()
