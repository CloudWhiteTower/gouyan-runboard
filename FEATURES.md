# RunBoard 与 SwanLab 的功能对照

核对日期：2026-11-06。本表用于说明本地单用户 RunBoard v0.2.0 的功能覆盖；SwanLab 的云、轻量离线看板、私有部署版应分别评估。

| 功能 | RunBoard v0.2.0 |
|---|---|
| 项目、实验、指标、超参数、比较 | 保留并扩展，中文界面与系统字体 |
| 参数配置模板与历史版本 | 保留；每次保存生成新版本 |
| 任意文件上传下载 | 保留，新增网页上传入口 |
| Optuna搜索 | 保留TPE/随机/网格及显式自定义worker |
| TensorBoard导入 | 保留只读、幂等导入 |
| 标签与分组 | 新增SDK设置、网页编辑与筛选 |
| 实验续记 | 新增状态恢复、自动步数延续、参数一致性检查；模型状态由训练代码恢复 |
| 训练环境 | 新增Python/系统/指定依赖版本与可用GPU信息，不记录环境变量 |
| CPU、内存、磁盘、网络 | 新增实验内历史曲线，训练进程显式开启采样 |
| GPU | 新增NVIDIA整卡利用率、显存、温度、功率；需系统nvidia-smi |
| 文本与终端日志 | 新增显式文本、stdout/stderr上下文采集、搜索与分页 |
| 图表分析 | 新增时间轴、最近/最优值、明确方向、相对基线比较 |
| 保存视图 | 新增本浏览器一份视图设置，非共享的多视图系统 |
| 媒体 | 新增文本、CSV、音频、视频预览；保留图片预览 |
| 自定义图表 | 新增JSON图表产物及直方图；支持折线/柱状/散点/热图 |
| 分子结构 | 新增PDB Cα骨架旋转；不是完整分子可视化工具 |
| Lightning/PyTorch | 保留并扩展，核心SDK无强制第三方依赖 |
| 多人账户、权限、共享链接 | 未实现；保持本机回环地址单用户使用 |
| 云端存储、离线队列与同步 | 未实现；HTTP记录需要本机服务可用，直接数据库模式另需服务端依赖 |
| 外部通知 | 未实现；本轮未接入邮件、飞书或其他发信服务 |
| 集群调度、其他硬件/框架 | 未实现；可在后续有明确需求时添加 |

参考官方来源，未复制其实现：

- [SwanLab SDK](https://github.com/SwanHubX/SwanLab)
- [系统监控](https://docs.swanlab.cn/guide_cloud/experiment_track/system-monitor.html)
- [日志和初始化模式](https://docs.swanlab.cn/api/py-init.html)
- [分子记录](https://docs.swanlab.cn/api/py-molecule.html)
- [自定义图表](https://docs.swanlab.cn/guide_cloud/experiment_track/log-custom-chart.html)
- [私有部署与版本边界](https://docs.swanlab.cn/self_host/enterprise-version.html)

当前实现继续使用既有MLflow、Optuna、ECharts，项目自有代码为Apache 2.0。数据在独立工作区，升级不替换既有实验。
