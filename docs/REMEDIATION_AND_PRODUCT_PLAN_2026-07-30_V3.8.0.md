# Lumina CRM v3.8.0 整改与增强计划

本计划来自 `AUDIT_2026-07-30_V3.8.0.md`。每项都必须有代码/配置、自动化合同和资料闭环；
除明确的真实生产基础设施外，不保留“仅建议、未实现”的仓库内事项。

## WP-1：共享宿主 rootless Docker 隔离

- [x] 增加受版本控制的 rootless daemon 配置和安装/验证说明。
- [x] 所有 Lumina Docker systemd unit 移除对 rootful `docker.service` 和 `/run/docker.sock`
  的依赖，统一使用部署环境中的固定 rootless `DOCKER_HOST`。
- [x] storage prepare/cleanup 继续运行 root-owned 固定程序，但进程身份降为 `lumina-crm`；
  程序仍拒绝从可写工作树启动。
- [x] 发布 runner 验证 socket 属于自身 UID、Docker 报告 rootless、cgroup driver 为
  systemd、data root 为 `/var/lib/lumina-crm/docker`。
- [x] 更新卷预配、builder、启动、备份、恢复和回滚命令，明确禁止 Lumina rootful fallback。

## WP-2：Compose 运维遗留修复

- [x] 修复 disk monitor 的 source 工作目录和 Compose/rootless 存储路径。
- [x] 磁盘百分比、rootless data root 和相关环境值使用 fail-closed 校验。
- [x] dry-run、实施状态和部署 runbook 只描述当前 Compose/rootless 架构。

## WP-3：数据库与对象恢复证据

- [x] 严格解析远端保留天数和本地保留小时数，拒绝 NaN/越界。
- [x] 本地清理使用显式 `BACKUP_LOCAL_RETENTION_HOURS`。
- [x] restore-test 可要求同时间戳对象归档；存在时执行解密和只读 tar 完整性检查。
- [x] 对象验证失败、缺失或数据库验证失败均返回非零，并继续清理临时数据库/明文文件。
- [x] 更新 backup/restore secret 模板和 runbook，区分本地短期副本与远端 provider lifecycle。

## WP-4：退出会话与共享 UI

- [x] logout API 对统一客户端返回 204，同时保留非 JS redirect。
- [x] 个人菜单使用带 CSRF header 的统一客户端；增加 pending、错误和可访问状态。
- [x] 查询改变时立即移除旧全局搜索记录。
- [x] 进度组件统一 finite、0–100 视觉/文本/ARIA 语义。
- [x] Chromium 通知阶段加入真实退出和重定向检查。

## WP-5：当前架构内核与镜像最小化

- [x] 将 `production-deploy-core.mjs` 缩减为当前 controller 实际使用的路径、请求和状态原语。
- [x] 删除 v3.6 release/symlink/systemd 旧合同，改为当前 rootless Compose 合同。
- [x] application/operations image 只包含运行入口所需脚本和库。
- [x] 新增 v3.8 行为合同，覆盖 rootless、磁盘、备份配对、退出和共享 UI。

## WP-6：有边界验证

- [x] 运行新增 v3.8 合同和部署合同。
- [x] 运行 typecheck、lint、迁移清单/Compose config 检查和一次生产 build。
- [x] 启动已验证生产 build，只运行直接受影响的 Chromium 通知/退出阶段。
- [x] 不运行完整十阶段 Chromium、完整数据库套件或真实生产部署。

## WP-7：复查、版本与提交

- [x] 逐项复查本计划，检查是否遗漏或半实现。
- [x] 保存最终复审和外部门禁。
- [x] 统一 `package.json`、lock、`lib/version.ts`、资料和版本合同到 v3.8.0。
- [x] `git diff --check`、确认工作树范围并创建单一发布提交。
