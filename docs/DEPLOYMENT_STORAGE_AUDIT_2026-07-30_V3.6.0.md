# Lumina CRM v3.6.0 部署存储安全审计

> **Archived / obsolete production architecture:** this v3.6 host-release audit is retained only
> as historical evidence. Use `docs/DEPLOYMENT.md` for the v3.7 Compose architecture.

审计日期：2026-07-30
审计范围：生产部署 runner、release 生命周期、磁盘监控、systemd/sudo 边界，以及共享
Docker/BuildKit 主机上的项目隔离。未执行生产部署，也未执行任何 Docker 清理命令。

## 结论

现有部署已经具备持久化 runner、不可变 Git worktree release、原子 current 切换、健康检查、
失败回退和 current/previous release 保护。应用构建使用宿主机 npm/Vinext，不依赖 Docker；
部署 runner 与 sudoers 还明确禁止直接接触 Docker，这一边界能够避免它任意操作共享主机上的
HunterAI、Temporal 和其他项目资源。

但首次生产部署前仍有以下存储缺口：

### P0-1：磁盘监控不是部署门禁

`scripts/check-disk-space.mjs` 只供每 15 分钟的 timer 告警使用，默认检查 PostgreSQL 和
Lumina 状态目录，而且只检查可用百分比。部署 runner 在拉取、安装依赖和构建前不会验证根
分区、Docker 数据目录、release 目录，也没有每个目标的最低可用字节门槛。磁盘不足仍可能
在构建、迁移或切换中途才暴露。

### P0-2：共享 Docker/BuildKit 没有 Lumina 项目边界

当前生产部署不运行 Docker 命令，因此不会误删其他项目；但也没有为未来或配套的 Lumina
镜像构建定义独立 builder、缓存上限、保留期限和精确镜像身份。直接引入宿主机全局 prune
会破坏现有安全边界，不能采用。

### P1-1：release 保留没有区分成功与失败

现有清理会保护 current、last-success.previous、刚激活 release 和按 mtime 排序的最近五个
目录。失败中的当前构建会在异常路径尝试删除，但历史中断残留没有独立期限；无 manifest 的
失败目录也可能占据“最近五个”名额，导致保留集合并不等于最近成功 release。

### P1-2：清理证据不完整

release 清理会逐项记录路径和错误，但没有记录清理前后磁盘状态、候选大小和实际可用空间
差值。共享 Docker 缓存和镜像也没有项目级报告。

### P1-3：接受新版本与清理完成之间缺少明确持久状态

正常异常会被 release 清理内部捕获，不会主动回退；但新版本通过全部健康检查后，runner 要
到清理结束才持久化 `SUCCESS`。若进程在这一小段窗口被强制终止，恢复逻辑可能把已经健康的
版本误判为未接受的 cutover。必须在清理前持久化“应用已接受”，并让清理失败保持非致命。

## 必须保留的安全边界

- 部署 runner 不获得 Docker socket 或任意 Docker CLI 权限。
- Docker 维护由 root 安装、固定入口、固定参数的 Lumina 专属 systemd 单元执行；仓库工作
  树中的可写脚本不能直接以 root 身份运行。
- 仅允许精确 builder `lumina-crm-buildkit`，以及同时具备 Lumina managed、repository、
  Compose project 标识和 Lumina repository tag 的镜像进入候选集。
- 不删除任何 container、network、volume；不触碰 PostgreSQL、备份、用户上传目录。
- 禁止 `docker system prune -a`、`docker image prune -a`、`docker volume prune`、
  `docker system prune --volumes`，也不使用无过滤的宿主机全局清理。
- current、上一个可回滚 release 和保留窗口内的最近成功 release 永远不进入删除集合。

## 审计后的目标

采用最小完整修改：在现有 runner 前后增加一个受限存储维护边界，修正 release 选择算法和
接受状态，不改变 npm/Vinext 构建、迁移、原子切换、Web/Worker 激活及健康检查主体。
