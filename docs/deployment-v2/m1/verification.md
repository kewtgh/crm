# M1 验证记录与证据边界

日期 2026-10-25；M0 基线 `0e786b1`；CRM `3.44.0`；M1 `0.1.0-experimental`。此文件是最小化人工审阅记录，不含原始 console、主机路径、PID、真实 policy 或生产数据。运行源码绑定和测量见 [resource-measurements.json](resource-measurements.json)。

| 检查 | 本次实际结果 | 备注 |
| --- | --- | --- |
| M1 单元 / 原生进程 | PASS，35 total / 33 pass / 0 fail / 2 NOT_RUN，约 4.44 s | 19 Windows 原生、11 注入观测、3 静态 / 纯函数；Linux flock 与 opt-in systemd 各 1 项未执行 |
| 最终 M1 typecheck | PASS，约 0.39 s | 包括 supervisor JS、runtime、最终 bundle 生成器 / 目录枚举限制 / measure；没有跳过类型检查 |
| 应用 typecheck | PASS，约 2.21 s | 只验证 namespace 排除项，未构建应用 |
| 最终 M1 Lint | PASS，约 3.23 s | namespace 的 src / tools / tests |
| 固定 Compose parser | PASS，约 2.28 s | 实际 Windows 2.40.3；无 daemon / 容器认证 |
| 公开隐私与 artifact 契约 | PASS，14 passed / 0 failed / 0 skipped，约 2.01 s | 最终代码与公开文档实际执行，不复用 M0 或早期结果 |
| Markdown / JSON / 链接 / schema 一致性 | PASS：14 份 Markdown、108 个本地链接、43 张表、1 个 JSON 示例、7 个 JSON 文件 | 不代表运行能力认证；最后变更后再次核对 |
| Git whitespace / 变更范围 | PASS | 只允许独立实验、专用 CI、文档和 tsconfig 隔离项；提交前再核对 staged 范围 |
| 外部 Linux CI / L2 / L3 / P0 | NOT_RUN | 无当前 M1 外部 run，不在生产补测 |

## Linux 测试矩阵的实际状态

| 设计测试 | 本地已执行内容 | 对应外部层结果 |
| --- | --- | --- |
| M1-01 Compose | Windows 官方 2.40.3 实际 config 与 tmpfs 回归 PASS | L1 Linux NOT_RUN；没有容器运行 |
| M1-02 detach | 已提供 opt-in transient unit 测试，默认拒绝未授权派发 | L2 NOT_RUN；未测真实会话断线 |
| M1-03 exit | Windows 实际退出 / kill / receipt 核对 PASS | L2 unit timeout / 子进程清理 NOT_RUN |
| M1-04 dispatch | Windows SQLite / CAS / grant / 恢复识别 PASS | Linux 锁与 systemd 派发 NOT_RUN |
| M1-05 concurrency | Windows 4 个真实 CLI 最多一个准入 PASS | L2 unit / installer / fence NOT_RUN |
| M1-06 restart | 无模拟重启冒充实际系统重启 | L3 NOT_RUN |
| M1-07 storage | 普通 Windows 事务 / 文件场景 PASS | L2/L3 journal / ENOSPC / EIO / power loss NOT_RUN |
| M1-08 resources | Windows 实际 RSS / CPU / 输出 / 文件快照 | L2 cgroup / 全进程树 / 正向 Linux 路径 NOT_RUN |
| M1-09 transport | 临时测试密钥 / OCI 验证器 PASS | 真实 CI provenance / 渠道 / Docker load NOT_RUN |
| M1-10 diagnostics | 模拟首因 / 隐私、Windows partial 路径、独立复制运行 PASS | Linux 全白名单路径只读性与预算 NOT_RUN |

没有执行 rootless provisioning、服务安装、VM、DIND、Runner 注册、重启、磁盘破坏、应用迁移或生产部署。没有运行完整应用 / 浏览器 / 数据库套件，也没有进行依赖升级或付费资源扩容。

M1 的 unit skip 有明确 NOT_RUN 原因，是尚未获得的能力。新 workflow 只提供后续 L1 执行定义，无 artifact 上传，不自动运行 opt-in systemd。没有从 mock、配置、文档或历史 app CI 得出生产兼容通过结论。

终检发现运行时 TypeScript 解析使两项诊断测试真实超出 128 MiB 保守峰值和；修正为开发阶段生成独立 JavaScript 包后，重新完成 33 pass / 0 fail / 2 NOT_RUN、类型、Lint 与资源测量。未放宽预算。目录运输另改为有界 opendir 枚举，已有负例扩展到 root / blobs / 内容三个层级，发现未列条目立即拒绝。

文档检查脚本最初找不到本地 YAML parser；未安装依赖补齐。最终完成 workflow 固定结构断言与人工审阅，完整 YAML parser / Actions 实际执行仍 NOT_RUN，不把静态检查称为 CI 运行通过。

最终文件应包含独立 `deployment-v2-m1/`、专用 workflow、M1 报告 / 导航和应用 tsconfig 的单一排除项。提交不包含忽略的 `work/`、V1 代码、根依赖或应用 release metadata；不推送、不部署。独立 Git commit 的具体身份在交付消息中给出，避免在提交自身文档中伪造自引用 hash。
