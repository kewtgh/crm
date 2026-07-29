# Lumina CRM v3.6.0 部署存储整改计划

> **Archived / obsolete production architecture:** this v3.6 host-release plan is retained only
> as historical evidence. Use `docs/DEPLOYMENT.md` for the v3.7 Compose architecture.

本计划来自 `DEPLOYMENT_STORAGE_AUDIT_2026-07-30_V3.6.0.md`。仓库内工作已全部执行；
实际 VPS 安装和首次生产部署明确未执行。

## WP-1：部署前磁盘门禁

- [x] 为根分区、Docker 数据目录和 Lumina release 目录生成统一磁盘快照。
- [x] 同时校验最低可用百分比和各目标最低可用字节，错误包含目标、路径、实际值和阈值。
- [x] 在 Git 拉取、依赖安装、构建和迁移之前执行；任一目标不满足即停止。
- [x] 验证 Docker daemon 报告的数据根与 Lumina 配置一致，避免检查错误挂载点。

## WP-2：项目级 BuildKit 与 Docker 边界

- [x] 提供 root 安装、固定路径的 Lumina 存储维护程序和 prepare/cleanup systemd 单元。
- [x] 创建或验证独立 `lumina-crm-buildkit` docker-container builder；同名但无所有权标记
  的 builder 必须拒绝接管。
- [x] 使用专属 BuildKit 配置设置保留期限、最大缓存、保底缓存及宿主机最小可用空间。
- [x] 镜像候选必须同时匹配 Lumina managed label、repository label、Compose project 和
  repository tag；使用中的镜像和最近镜像受保护。
- [x] Docker 命令白名单拒绝全局 prune 及任何 container/network/volume 删除。

## WP-3：成功后的 release 与 Docker 清理

- [x] 新版本完成 Web/Worker 激活、loopback liveness/readiness 和公网健康检查后，先持久化
  `applicationAccepted`，再执行任何清理。
- [x] 保留 current、上一个可回滚版本及最近五个成功 release。
- [x] 删除更旧成功 release，以及超过 24 小时、无成功 manifest 的失败/中断构建残留。
- [x] release 清理失败或 Docker 维护单元失败只记录告警，不回退或中断已健康的生产版本。
- [x] runner 被强制中断后，已接受版本进入完成清理路径，不能被当作失败 cutover 回退。

## WP-4：审计日志

- [x] 记录清理候选、逐项删除结果、候选估算大小、BuildKit prune 输出。
- [x] 记录清理前后根分区、Docker 数据目录和 release 目录的总量、可用量、百分比与空间差值。
- [x] 将维护报告写入 Lumina 专属状态/日志目录，并由部署日志引用；不记录 secrets。

## WP-5：自动化合同

- [x] 测试磁盘门禁通过和失败。
- [x] 测试成功 release、current、rollback 和失败残留的选择规则。
- [x] 测试 HunterAI、Temporal、其他项目及部分伪造标签不能进入镜像候选。
- [x] 测试 Docker 命令白名单拒绝全局 prune 和 volume/network/container 删除。
- [x] 测试清理异常为非致命，且中断恢复不回退已接受生产版本。
- [x] 运行限定的部署测试、production asset dry-run、typecheck 和 lint；不运行生产部署。

## WP-6：交付

- [x] 更新生产部署手册、首次主机安装步骤和运维命令。
- [x] 统一版本到 v3.6.0。
- [x] 复核计划遗漏，检查 diff；提交结果记录在最终复审。
