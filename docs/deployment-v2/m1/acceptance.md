# Deployment V2 M1 验收报告

日期：2026-10-25。设计基线 `0e786b190ceabbb0716cac4242b0ed8d82313669`（M0 v0.2）；应用版本 `3.44.0`；独立实验版本 `0.1.0-experimental`。本次实现、验证与提交仅限仓库和开发环境，没有替换 V1 或执行生产命令。

**判定：M1 本地实验与缺口交付完成；外部 Linux 动态验收未通过认证，结果 NOT_RUN。M2 离线 alpha 开发 GO；生产安装、生产诊断运行、写入版发行 NO_GO。** 保持 oneshot 首选，不据未测项新增常驻服务。

## 变更与依赖边界

| 路径 | 实际交付 |
| --- | --- |
| [deployment-v2-m1/](../../../deployment-v2-m1/README.md) | 仅 Node 内置模块的独立实验 namespace；无应用 / V1 运行依赖、无新增 npm 依赖 |
| [lifecycle-cli.ts](../../../deployment-v2-m1/src/lifecycle-cli.ts) / store / lifecycle | 虚构任务 CLI、真实 SQLite 原子准入、CAS / 一次性 grant、receipt 核对、非生产 opt-in transient oneshot 原型 |
| [diagnostics-cli.mjs](../../../deployment-v2-m1/src/diagnostics-cli.mjs) / collector | 开发侧生成独立纯 JavaScript 包；只读命令白名单、正向提取、错误首因 / 依赖状态、有界 supervisor |
| [diagnostics schema](../../../deployment-v2-m1/schemas/diagnostics-v1.schema.json) | 固定字段、状态 / errno / 阶段枚举；拒绝私有额外字段、伪造认证或生产批准 |
| [transport.ts](../../../deployment-v2-m1/src/transport.ts) | 虚构来源政策签名与小型 OCI 内容图验证；不调用 Docker load、不访问 Registry |
| [测试与工具](../../../deployment-v2-m1/tests/lifecycle.test.mjs) | 35 个测试项、能力 inventory、真实 Compose parser、资源测量；实际测试分类见下表 |
| [专用外部 CI](../../../.github/workflows/deployment-v2-m1.yml) | 无生产凭据的托管 Linux job 定义；有界测试、固定官方 Compose hash、隐私门禁；未推送 / 未执行 |
| [应用 tsconfig](../../../tsconfig.json) | 仅排除独立 NodeNext 实验目录；应用原有类型检查仍通过 |

没有修改 `deploy-production.mjs`、Bootstrap / Runner、V1 状态 / 归档协议、应用或业务数据库代码、生产 Docker / Compose / BuildKit / systemd，也没有访问同机其他项目。没有 installer、正式 Agent bundle、应用迁移或容器切换能力。根 package / lockfile、CRM release metadata 不变；M1 pre-release 不触发应用版本升级。

## 实际验证结果

环境为 Windows 开发机，Node `24.22.1`、内置 SQLite `3.53.4`，数据全为独立虚构任务。输入 / 证据绑定见 [能力清单](capability-inventory.json)、[资源测量](resource-measurements.json)；运行源码 digest 为 `056eebe627473927c86adf467e287e2ed032222221fc8ed77ce02ea5c7d2cbcc`，计算规则为按文件名排序的 `src/` 文件名与 SHA-256 清单再 SHA-256，不是生产发行签名。

| 检查 | 实际结果 | 范围与限制 |
| --- | --- | --- |
| 独立单元 / 原生进程测试 | PASS：35 项中 33 passed、0 failed、2 明示 NOT_RUN；约 4.44 秒 | 19 项 Windows 原生 SQLite / 文件 / 进程 / crypto；11 项注入 Linux 观测的模拟；3 项静态 / 纯函数；2 项真实 Linux 测试未执行 |
| M1 严格类型检查 | PASS | 独立 NodeNext、TS / JS supervisor 均检查；使用锁定的原生 TypeScript compiler |
| 应用类型隔离检查 | PASS；约 2.21 秒 | `tsc --noEmit --incremental false -p tsconfig.json`；无应用构建或业务回归 |
| M1 Lint | PASS；约 3.23 秒 | `src`、`tools`、`tests`；未引入 lint bypass |
| 最终类型 / Lint 复核 | PASS；约 0.39 / 3.23 秒 | 包含最终 bundle 生成器、运输枚举限制和测量工具 |
| 公开隐私 / artifact 契约 | PASS：14 passed、0 failed、0 skipped；约 2.01 秒 | 最终代码与公开文档的 tracked / candidate 文件；新 CI 不上传原始证据 |
| 原生 Compose 2.40.3 | PASS；约 2.28 秒 | Windows 官方固定 hash 二进制实际执行 version / config；安全合成模型与未引用 tmpfs 错误回归；未连接 daemon，不代表容器集成 |
| 外部 M1 Linux CI | NOT_RUN | 只编写 workflow；旧应用 CI 成功不能认证本次代码 |
| L2 / L3 | NOT_RUN | systemd user manager、Rootless、cgroup 限额、真实终端断开、重启 / 断电 / 磁盘故障均未实测 |
| 生产 P0 只读适配 | NOT_RUN | collector 明确 NONPRODUCTION_TEST / UNATTESTED_M1，尚不允许生产运行 |

测试没有把 Mock 结果标成 Linux 认证：例如模拟 `EACCES` 必须输出 socket 的 `UNKNOWN / METADATA_PERMISSION_DENIED / READ_METADATA / EACCES`，daemon 与 isolation 依赖项为 `NOT_RUN / DEPENDENCY_UNRESOLVED`，不再形成无法解释的 `docker.isolation=false`。真实非 rootless、data-root / cgroup 不符、字段缺失 / 类型错误分别保留独立首因；原始路径、stderr 和版本注入值不输出。

真实进程测试覆盖四 CLI 并发仅一个准入、重复 key / grant、崩溃前后 receipt、实际 kill、仍活跃 worker 拒绝 reconcile、生成独立诊断包后脱离应用运行。它们不证明 systemd 子进程清理、Linux 锁、断电事务或数据库迁移 exactly-once。后续决策见 [lifecycle-decision](lifecycle-decision.md)。

## 可复核的检查命令

均从仓库根目录执行，一次一个 55 秒 watchdog。根目录使用已锁定开发工具，不为 M1 安装新依赖。

```text
node scripts/run-bounded.mjs --label m1-unit --timeout-seconds 55 --idle-seconds 45 -- node --test --test-concurrency=1 deployment-v2-m1/tests/*.test.mjs
node scripts/run-bounded.mjs --label m1-typecheck --timeout-seconds 55 --idle-seconds 45 -- node node_modules/@typescript/native/bin/tsc -p deployment-v2-m1/tsconfig.json
node scripts/run-bounded.mjs --label crm-typecheck-isolation --timeout-seconds 55 --idle-seconds 45 -- node node_modules/@typescript/native/bin/tsc --noEmit --incremental false -p tsconfig.json
node scripts/run-bounded.mjs --label m1-lint --timeout-seconds 55 --idle-seconds 45 -- node node_modules/eslint/bin/eslint.js deployment-v2-m1/src deployment-v2-m1/tools deployment-v2-m1/tests
node scripts/run-bounded.mjs --label m1-real-compose --timeout-seconds 55 --idle-seconds 45 -- node deployment-v2-m1/tools/compose-integration.ts
node scripts/run-bounded.mjs --label m1-public-privacy --timeout-seconds 55 --idle-seconds 45 -- node --test --test-isolation=none tests/public-repository-privacy.test.mjs tests/public-ci-artifacts.test.mjs
```

Compose 命令需显式 `M1_COMPOSE_BINARY` 指向经固定 hash 核验的二进制；没有该输入则拒绝执行，不自动搜索 daemon。inventory / measure 只接收指定的新输出文件；原始本地材料留在 Git 忽略的 `work/`，公开文件只保留人工审阅的有限状态和数值。

## 诊断只读、隐私与资源

运行时没有 DB / TCP / HTTP 客户端、自动提权或修复动作。白名单仅本地只读 Docker info、可信 Compose 二进制的合成模型解析、固定 systemctl show、指定项目元数据 / cgroup / statfs。清除继承的 Docker context / Node options / proxy，不 fallback 到 rootful socket；不读取业务行或扫描邻居。报告仅随机 subject、不包含 policy 实值或原始异常文本；新输出排他创建，已有文件不覆盖。

M1 的本地文件快照实测：除指定报告增加 1 个文件，既有虚构文件字节 digest 全部不变。此结果来自 Windows 平台提前报告 Linux 不适用的路径；Linux 命令路径只读性、全进程树资源及无越界行为仍需外部验证，静态白名单和 Mock 不替代它们。Buildx plugin 来源验证和状态库只读 / hot-journal reader 尚未实现，报告分别显式 NOT_RUN，不读取 V1 文件补齐。

| 项目 | Windows 本次实测 | 后续门槛 |
| --- | --- | --- |
| 虚构 worker | 峰值 RSS 79,798,272 B（约 76.1 MiB）；CPU 108 ms；墙钟 179 ms；一个 receipt | 非生产 Linux 同候选摘要全进程树 / systemd 限额实测 |
| SQLite | 文件 32,768 B（32 KiB），无需服务 | Linux journal / ENOSPC / EIO / 断电；不能外推业务状态增长 |
| 诊断 collector / supervisor | 分别 64,720,896 / 61,386,752 B；保守峰值和 126,107,648 B（约 120.3 MiB）；墙钟 223 ms | 两个短进程、空闲为 0；Linux 查询子进程峰值与内核硬 RSS 仍 NOT_RUN |
| 诊断输出 / JavaScript 包 | 输出 11,064 B；采集阶段 4 ms；代码 / hash manifest 包 40,188 B，不含 Node | Windows partial 路径；上限 45 秒、JSON 1 MiB、单命令 3 秒 / 256 KiB |
| 运输 fixture | 796 B OCI 对象、1024 B 内容；16 ms 验证 | 无真实 CI attestation / load / Docker 增量；1820 B 仅算法下界 |
| 实验运行源码 | 64,094 B | 未包含私有 Node、正式 verifier / 签名 / SBOM，不能作为正式 Agent 大小 |

复核曾真实触发两项 `DIAGNOSTIC_AGGREGATE_MEMORY_LIMIT`，因此将运行时 TypeScript 解析移到开发侧固定 Node 的包生成步骤，保留失败证据与 128 MiB 门槛，没有放宽断言。最终完整测试与上表测量使用纯 JavaScript 包；生成器的 experimental API 不进入采集进程。

诊断采用 48 MiB V8 old-space profile、超时进程树终止、输出限额、RSS 检查及 supervisor + collector 峰值和检查；old-space 不是总 heap 或 RSS 硬上限。系统级 128 MiB 全树硬限制未证实，明确为 NOT_RUN，不降低门槛宣称通过。发行和生产资源差额见 [production-additions](production-additions.json)。

Schema 文件与生成器一致，额外私有字段 / 伪造生产批准负例通过；当前 Ajv 6 只检查共用 assertion 子集，没有完整 draft-2020-12 metaschema 验证。正式 Schema 工具链与来源签名在 M2 冻结。

## 外部能力与 M2 Go / No-Go

现有外部 Actions 服务的只读历史 run 元数据可访问；新 M1 workflow 没有推送执行。开发机 WSL 枚举返回非零，仅证明本次接口不可用，不推断没有任何已安装发行版。没有新建 VM、DIND、CI Runner、Registry、数据库或生产文件。

M2 离线 alpha 的必要输入已经具备：隔离 namespace、真实 SQLite 协议 / grant 试验、首因与隐私 Schema、候选运输验证器、资源测量和明确缺口。因此允许继续开发，不等于所有 M1 动态门槛通过。生产新增本次为文件 0、unit 0、进程 0、DB 实例 0、磁盘 0。

以下条件未齐前保持生产 NO_GO：

1. 在本次或后续确切候选摘要上执行真实外部 Linux / flock / Compose；记录实际 runner、OS / kernel / 文件系统 / 软件包 hash，不能用浮动 Ubuntu runner 声称目标 Ubuntu 26.04 包线兼容。
2. 取得可隔离的 L2/L3 环境，补 oneshot、终端断开、单写入 / 升级竞争、Rootless / cgroup、进程树 / 限额、OS reboot / power loss / 磁盘故障，逐项保留真实执行证据。
3. M2 固定一个正式 unit / 启动器、私有 runtime / verifier、事务 store / grant、正式签名信任链、一个实际可传递的运输格式；M3 验证 Docker load 内容映射、真实虚构发布与恢复，M1 测试密钥不成为信任根。
4. collector 补安全只读状态 reader 或缩小正式范围，完成 Linux 全路径只读 / 隐私 / 总预算验收；之后管理员才可另批 P0，只读通过仍不授权安装或真实业务发布。
5. 继续保留 M0 的 V1 fence / owner 交接、兼容回退与管理员变更窗口门槛。缺基础设施只记录 NOT_RUN，不在生产补测，也不添加常驻 Agent 来掩盖缺口。

没有运行整套应用构建、浏览器矩阵或业务数据库回归，因为本阶段没有修改应用行为；没有把这些未运行项列为通过。本次检查与最终提交范围记录见 [verification](verification.md)。
