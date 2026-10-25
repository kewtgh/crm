# M2.2 Rootless 与目标发行包验证计划

基线 Agent `0.2.0-alpha.1`、M2.1 测试 `19589e49106dd98efa369951685b4022a88c37d1`、报告 `3989b2d`。不改 Agent 功能、V1 或生产，不重写 M2.1 证据。

## 初审与边界

M2.1 Runner image `20261012.334.1` 的 [toolset](https://github.com/actions/runner-images/blob/ubuntu24/20261012.334/images/ubuntu/toolsets/toolset-2404.json) 未列 Rootless extras；[安装脚本](https://github.com/actions/runner-images/blob/ubuntu24/20261012.334/images/ubuntu/scripts/build/install-docker.sh) 使用 no-install-recommends。Docker CE 的 extras 是 Recommends，不是必装依赖，因此不能从 docker-ce 已安装推出两个 Rootless 程序存在。

M2.1 的原始准备错误没有上传，既有摘要只证明程序缺失，不能恢复当时 apt-get 的准确首因。M2.2 将记录现 Runner 初始包状态、旧流程 update 退出码 / 安装计划模拟，以及新流程结果；模拟不计为 Rootless 动态证明，也不冒充历史现场日志。官方 APT 中 28.0.4 的 Engine / extras 均带 `5:` epoch，未发现 epoch 格式不匹配证据。

## 外部环境

复用 GitHub 托管的 Ubuntu 24.04 / 26.04 可丢弃 VM；[官方 Runner 列表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) 当前提供这两个标签。M2.2 使用独立验证分支和 workflow，PR 不安装 fixture；每 job 18 分钟，准备步骤 10 分钟、非特权 harness 240 秒。用户批准具体候选后推送，不推送 main。

- 24.04：复用既有 Docker CE，仅从受签名 APT 索引下载匹配版本 extras 并提取到 fixture，RootlessKit / uidmap 等用 Ubuntu helper 包。没有重装或升级 Engine。
- 26.04：优先取 Ubuntu `docker.io` 29.1.3、`docker-compose-v2` 2.40.3、`docker-buildx` 0.30.1；提取到私有 fixture，配套提取 Ubuntu containerd / runc，不安装系统服务、不替换 Runner rootful Docker。每包保存 revision / SHA-256；取不到的组件逐项 NOT_RUN，不改用 CE 冒充 Ubuntu 包。
- apt 仅使用已有官方 Ubuntu / Docker sources 的任务专属副本，验证签名不变，不改全局源 / key。RootlessKit 复用系统包提供的 AppArmor 路径；不关闭 AppArmor、sysctl、默认权限或资源限制，不强改控制器委派。

## 动态验证与证据

新 UID 不加入 docker 组；独立 Unix socket、data-root、user manager、cgroup v2 / systemd driver。原 Alpha 固定 oneshot 只运行一次虚构 checkpoint，记录 grant / PROVEN / idle、128 MiB / 1 CPU / 32 tasks 及实际进程树资源。

Rootless daemon 下运行固定 digest 的预构建 Node 镜像，复用 M2.1 压力程序；记录容器内部真实 cgroup 数字、CPU 节流、PID 拒绝和 OOMKilled / exit137；Compose 只运行虚构容器，Buildx 只核对版本，不构建 CRM。Rootful 结果不计入这些项目。

启动前记录 user manager 的 baseline 失败集合；用受限 false oneshot 制造且明确归属一个测试失败 unit，再仅 reset 该 unit。清理只处理本次已知 unit，核对 baseline 集合不变，保留外来失败；不使用无参数 reset-failed。分别测量 Agent 与 daemon，daemon 是临时测试设施，生产新增资源 0。

公开只上传固定 `deployment-v2-rootless-summary.json`，以 profile / SHA / run / attempt 绑定，正向提取包版本 / 摘要、数值内核与资源观测、固定状态和原因。未知 / 缺失能力保留 NOT_RUN，整体 INCOMPLETE，生产 NO_GO。原始 apt / journal / 诊断仅留忽略 work/。最终形成独立验收报告；重启和磁盘故障仍需专用非生产设施。
