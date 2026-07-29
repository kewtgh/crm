# Lumina CRM v3.6.0 部署存储最终复审

> **Archived / obsolete production architecture:** this v3.6 host-release review is retained only
> as historical evidence. Use `docs/DEPLOYMENT.md` for the v3.7 Compose architecture.

复审日期：2026-07-30
输入：`DEPLOYMENT_STORAGE_AUDIT_2026-07-30_V3.6.0.md` 与
`DEPLOYMENT_STORAGE_REMEDIATION_PLAN_2026-07-30_V3.6.0.md`

## 结论

整改计划没有仓库内遗漏或半完成项。生产部署未执行，Docker 清理命令未执行；本次只修改并
验证了仓库内的自动部署资产。

## 逐项复核

| 要求 | 结果 |
| --- | --- |
| 部署前容量门禁 | root、Docker daemon 实际 data root、release root 同时检查字节和百分比；不足时在 Git pull 前失败 |
| 清理时序 | Web/Worker、loopback liveness/readiness、公网 health 全部通过并持久化 `applicationAccepted` 后才清理 |
| release 保留 | 保护 current、last-success.previous、当前激活 release 和最近 5 个成功 manifest |
| 失败残留 | 超过 24 小时且无成功 manifest 的 release 进入候选；当前/rollback 仍受保护 |
| BuildKit | 固定 `lumina-crm-buildkit` docker-container builder、root-owned marker/config、7 天/12 GiB GC |
| 镜像隔离 | managed、repository、Compose project、repository tag 四项同时匹配；使用中和最近两个镜像受保护 |
| 禁止全局清理 | 命令白名单拒绝 system/image 全局 prune、volume/network/container 删除及 `--volumes` |
| 其他项目与数据 | HunterAI、Temporal、部分伪造标签、PostgreSQL volume、备份、上传、network/volume 均不在候选模型 |
| 证据 | release 与 Docker 报告记录候选、删除结果、估算大小、BuildKit 输出和清理前后磁盘差值 |
| 清理失败 | 非致命；已接受生产版本不回退，中断恢复进入 accepted finalization |
| 权限边界 | runner 没有 Docker CLI/socket 权限，只能启动固定 systemd 单元；root 不运行可写 Git 工作树代码 |

## 最终验证

| 检查 | 结果 |
| --- | --- |
| `npm run test:deploy` | 23/23 通过 |
| `npm run deploy:production:dry-run` | 通过；无副作用 |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npm run build` | v3.6.0 通过 |
| `git diff --check` | 通过 |
| 生产部署 / Docker prune | 未执行 |

未运行数据库、完整 Chromium 或全仓库回归矩阵：本次是部署存储边界修改，限定部署合同、
静态检查、资产 dry-run 和一次最终 build 已覆盖直接风险，符合仓库的时限化验证规则。

## 首次生产部署前的外部动作

仓库不能伪造实际 VPS 安装结果。环境所有者必须按 `docs/DEPLOYMENT.md` 将维护程序安装到
`/usr/local/libexec`（root-owned），安装两个 storage systemd 单元、BuildKit 配置和 sudoers，
校验 `LUMINA_DOCKER_DATA_ROOT` 后，先运行 `npm run deploy:production:dry-run`。只有这些步骤
完成后才可进行首次真实生产部署。
