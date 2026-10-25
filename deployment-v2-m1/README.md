# Deployment V2 M1：独立实验与只读诊断

版本 `0.1.0-experimental`，设计基线 `0e786b1`，CRM 仍为 `3.44.0`。这是虚构任务实验程序，不是生产 Deployment Agent、安装器或 V1 替代入口。验收与能力缺口见 [M1 报告](../docs/deployment-v2/m1/acceptance.md)。

## 隔离与入口

运行代码只使用 Node.js 24.22.1 内置模块，包括 `node:sqlite`；没有 CRM、V1、PostgreSQL、npm 包或远程服务的运行依赖。测试和静态检查复用根目录 lockfile 中的开发工具。这个实验包尚未提供 M2 所需的私有 Node、独立发行 lockfile、SBOM、签名包或安装 / 回退程序。

| 模块 | 职责 |
| --- | --- |
| `src/lifecycle-cli.ts`、`store.ts`、`lifecycle.ts` | 提交虚构任务、SQLite 事务准入、一次性 grant、内核锁、独立进程、证据核对；显式批准后才允许非生产 transient oneshot |
| `src/diagnostics-cli.mjs`、`diagnostics-worker.ts` | 短期 supervisor / collector，固定白名单采集、正向提取 JSON；开发侧生成独立纯 JavaScript 包 |
| `src/diagnostics.ts`、`observation.ts`、`compose.ts` | 固定 policy、准确首因与依赖、只读本地命令、独立合成 Compose 安全模型 |
| `schemas/diagnostics-v1.schema.json` | 严格字段白名单，强制 `NONPRODUCTION_TEST`、`productionApproved=false`、`compatibilityCertified=false` |
| `src/transport.ts` | 虚构 Ed25519 身份政策和小型 OCI layout 的完整性验证，不下载、不加载镜像 |
| `tools/` | 能力清单、原生 Compose parser、资源测量与临时运输 fixture；输出仅到指定新文件 |

Lifecycle 只接受系统临时目录下新建的 `lumina-m1-<UUID>` 直接子目录；拒绝现有目录、符号链接、硬链接状态库和任意 shell 任务。Linux CLI 写入必须通过真实 `flock`，worker 核对自己的 `/proc/locks` 身份。Windows 明确使用 `WINDOWS_SQLITE_ONLY`，不模拟 Linux 锁。

## 开发验证

从仓库根目录、已安装锁定的开发依赖时运行；每项命令分开执行。无需应用构建、业务数据库或浏览器。

```text
node scripts/run-bounded.mjs --label m1-unit --timeout-seconds 55 --idle-seconds 45 -- node --test --test-concurrency=1 deployment-v2-m1/tests/*.test.mjs
node scripts/run-bounded.mjs --label m1-typecheck --timeout-seconds 55 --idle-seconds 45 -- node node_modules/@typescript/native/bin/tsc -p deployment-v2-m1/tsconfig.json
node scripts/run-bounded.mjs --label m1-lint --timeout-seconds 55 --idle-seconds 45 -- node node_modules/eslint/bin/eslint.js deployment-v2-m1/src deployment-v2-m1/tools deployment-v2-m1/tests
```

原生 TypeScript 由 Node 类型擦除执行，应用 `tsconfig.json` 只增加本目录排除项，使 ES2017 应用编译不混入实验的 NodeNext / BigInt 合约。没有修改应用构建或 V1 部署执行路径。

最小虚构任务示例，以下 PowerShell 命令仅用于开发机：

```powershell
$experimentRoot = Join-Path ([IO.Path]::GetTempPath()) ("lumina-m1-" + [guid]::NewGuid())
node deployment-v2-m1/src/lifecycle-cli.ts init --root $experimentRoot
node deployment-v2-m1/src/lifecycle-cli.ts submit --root $experimentRoot --key fictional-request-01
node deployment-v2-m1/src/lifecycle-cli.ts run --root $experimentRoot
node deployment-v2-m1/src/lifecycle-cli.ts status --root $experimentRoot
node deployment-v2-m1/src/lifecycle-cli.ts reconcile --root $experimentRoot
```

`CRASH_BEFORE_EFFECT` / `CRASH_AFTER_EFFECT` 是实验 failpoint，进程分别实际退出 23 / 24。已领取 grant 不会重新排队；没有 receipt 的结果停在 `RECOVERY_REQUIRED`。receipt 只证明虚构文件效果，不证明任何业务副作用。没有时间阈值自动解锁、重置 grant 或自动恢复操作。

`dispatch` 仅在非 root Linux、初始化时显式 `--allow-systemd ACK_NONPRODUCTION` 的实验根目录可用。`tests/systemd.test.mjs` 还要求 `M1_ISOLATED_SYSTEMD=ACK_NONPRODUCTION`。它创建有界的实验 transient user unit，测试 CLI 退出后 manager 接管；不安装生产固定 unit，不配置 linger，不自动启用外部主机的测试权限。真实终端断开、重启和系统限额仍需 L2/L3 证据。

## 诊断 MVP

在开发环境预先创建受控输出父目录，再生成新的诊断包目录。生成器只用 Node 内置类型擦除 API，固定输入与每文件摘要，没有 npm 构建依赖；其 experimental API 属于固定 Node 版本的开发工具，不进入采集运行时。包生成后可独立传到非生产环境，使用 [虚构 policy](fixtures/policy.example.json)。真实 policy / 原始报告只保存于受控位置或忽略的 `work/`，不提交 Git。

```text
node deployment-v2-m1/tools/build-diagnostics.ts --output work/deployment-v2-m1/diagnostics-runtime
node --max-old-space-size=48 work/deployment-v2-m1/diagnostics-runtime/diagnostics-cli.mjs --policy deployment-v2-m1/fixtures/policy.example.json --output work/deployment-v2-m1/example-report.json
```

只读取确切项目 UID / Unix socket / data-root / 配置目录元数据；调用可信固定 Docker、Compose、systemctl 查询入口。Compose 只解析工具内置的合成 YAML，不加载应用配置、不访问 daemon 执行容器。不会列出或扫描其他项目、读取业务库、修改状态、自动提权、安装依赖或连接外网。唯一指定输出以 `wx` / 0600 新建，拒绝覆盖。固定错误码中不含原始 stderr、路径、UID、主机名或异常文本。

45 秒总时限、单命令 3 秒、stdout + stderr 256 KiB、最终 JSON 1 MiB；supervisor 协议 16 KiB。两个短进程均使用 48 MiB V8 old-space profile，检查各自 RSS，并以二者峰值之和保守检查 128 MiB；该检查不是内核硬 RSS 约束，也不覆盖 Docker / systemctl 子进程。运行时不加载 TypeScript 解析器，直接执行生成的 `.mjs`。L2 全进程树内存验证与硬限制为 NOT_RUN，工具不获准在生产运行。包内 hash manifest 不构成发行签名，也未携带私有 Node。

退出码：0=完整且无阻断，2=完整但有阻断，3=部分 / 未知，1=工具失败。当前 Buildx 采集与状态库只读 reader 尚未实现，均明确 NOT_RUN，所以即使注入的主机检查全通过也仍是 partial。输出存在不代表采集或预算验收成功；必须核对退出码、schema、scope 和证据来源。

JSON Schema 声明 draft 2020-12。当前测试使用根目录既有 Ajv 6 检查双方共有的 assertion 子集，并核对生成文件；没有声称完成 2020-12 metaschema 认证。M2 若形成正式协议，须补相应验证器与发行测试。

## CI 与运输边界

[外部 workflow](../.github/workflows/deployment-v2-m1.yml) 仅使用托管 runner，权限 `contents:read`，没有生产凭据、服务安装、Rootless provisioning 或 artifact 上传。它准备经 SHA-256 固定的官方 Compose 2.40.3 parser，执行 Linux 原生文件 / SQLite / flock 测试；浮动 `ubuntu-latest` 不是目标 Ubuntu 包线认证。本地尚未提交推送的 workflow 没有运行证据，外部 Linux 结果均为 NOT_RUN。

`tools/compose-integration.ts` 要求显式 `M1_COMPOSE_BINARY`；不自动下载或回退到任意 Docker daemon。Windows 和 Linux 官方二进制 hash 分别固定，实际执行 `version` 和 `config`，同时复现未引用 tmpfs flow value 的真实 parser 错误。

运输实验只验证临时生成的测试密钥、固定身份字段、OCI manifest / config / layer digest 及解压内容 digest；没有生产 CI provenance、信任根或真实 Docker load。16 MiB 单对象、8 MiB 解压上限只适用于小型实验，不适用于真实应用镜像。评估与 M2 前提见 [运输决策](../docs/deployment-v2/m1/transport-decision.md)。
