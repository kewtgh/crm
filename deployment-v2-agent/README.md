# Lumina Deployment Agent Offline Alpha

独立版本 `0.2.0-alpha.1`，Node `24.22.1`，store epoch / agent protocol 均为 1。以 M0 `0e786b1`、M1 `e93cc03` 为基线；CRM 仍为 `3.44.0`。这是无生产副作用的离线 Alpha，不是生产部署器。[M2 验收与能力清单](../docs/deployment-v2/m2/acceptance.md)。

## 模块与接口

| 模块 | 接口 / 职责 |
| --- | --- |
| [cli](src/cli.ts) | `init`、`plan`、`submit`、`status`、`reconcile`、`render-unit`、`dispatch`；固定参数白名单 |
| [worker](src/worker.ts) | 只领取 EXECUTE / RECONCILE grant；唯一任务为 `FICTIONAL_CHECKPOINT`，无迁移 / 容器 / 升级动作 |
| [protocol](src/protocol.ts) / [store](src/store.ts) | 请求与计划绑定、SQLite 事务、revision CAS、一次性 grant、intent / receipt / event |
| [platform](src/platform.ts) | 同一项目 flock、进程执行身份、固定 user unit 渲染及派发；不安装 / enable / reload unit |
| [readonly](src/readonly.ts) | 不创建数据库、不恢复 journal 的最小状态快照与错误分类 |
| [state diagnostics](src/diagnostics-cli.mjs) | 单进程、短 worker thread、有界只读 JSON；不启动 Agent，独立于 CRM / V1 |
| [release](src/release.ts) / [OCI](src/oci.ts) / [verifier](src/verifier.ts) | 离线目录 v1、固定身份政策、Ed25519、内容图和资源边界；不执行候选代码 |
| [build](tools/build.ts) | 开发侧类型擦除、复制固定 Node 私有运行时、冻结 payload hash；独立生成 verifier |

运行代码只 import Node builtins 和同包模块；没有 CRM / V1 / M1 / npm / 外部服务的运行依赖。测试复用根目录锁定的开发工具；本包有独立零依赖 lockfile、版本和 [CHANGELOG](CHANGELOG.md)。普通任务不能更新 Agent，平台 / 源码摘要漂移或错误 Node 路径会在准入前被拒绝。

## 本地构建与虚构任务

从仓库根目录使用固定 Node。输出必须是新目录，父目录预先存在；构建不修改全局 Node、Docker 或 systemd。私有 Node 的来源目前是受控开发 / 测试环境中的精确 Node 二进制，正式发行 provenance / SBOM / installer 仍未完成。

```text
node deployment-v2-agent/tools/build.ts --output work/deployment-v2-m2/agent-alpha
node deployment-v2-agent/tools/build.ts --verifier-output work/deployment-v2-m2/independent-verifier
```

Windows 示例；Linux 使用包内 `runtime/node`。该二进制所在文件系统必须允许执行，不能在 `noexec` 挂载上测试后宣称运行时损坏。

```powershell
$alphaRoot = Join-Path ([IO.Path]::GetTempPath()) ("lumina-v2-alpha-" + [guid]::NewGuid())
$alphaNode = (Resolve-Path work/deployment-v2-m2/agent-alpha/runtime/node.exe).Path
$alphaCli = (Resolve-Path work/deployment-v2-m2/agent-alpha/lib/cli.mjs).Path
& $alphaNode --max-old-space-size=64 $alphaCli init --root $alphaRoot --ack-nonproduction
& $alphaNode --max-old-space-size=64 $alphaCli plan --root $alphaRoot
& $alphaNode --max-old-space-size=64 $alphaCli status --root $alphaRoot
```

`submit --root <alpha-root> --request <request.json>` 接收 [协议](../docs/deployment-v2/m2/protocol-and-release.md) 中的 request；不是 shell 或 unit 配置。手动前台执行可调用包内 `lib/worker.mjs --root <alpha-root>`，Linux 会取得真实 flock。生产入口没有接入这些命令。

`reconcile --operation <id> --revision <expected>` 只授权在原操作里采证；随后 worker 消费新的 RECONCILE grant。无 receipt 必须保留 UNKNOWN，不因时间、PID 消失、unit inactive 或新进程启动就再次执行。

## 固定 oneshot

初始化只有显式 `--allow-systemd` 且非 root Linux 才允许渲染测试 unit。`render-unit --output <new-file>` 只导出，不安装。`dispatch` 只启动预先受审的 `lumina-crm-deployment-v2-alpha.service`，核对固定 FragmentPath、文件 hash、无 drop-in、无需 reload；不能传 unit 名或属性。

unit 直接执行 `flock --no-fork` 再进入包内 Node / worker，正常 unit 不需要额外 Node 锁代理。固定 Type=oneshot、Restart=no、RemainAfterExit=no、KillMode=control-group、15 秒、128 MiB、1 CPU、32 tasks；实际 cgroup / user manager 行为仍 NOT_RUN。空闲不增加 daemon、timer、API socket 或数据库服务。

真实 systemd 测试只在已有、匹配本包的非生产绑定上显式设置 `M2_ISOLATED_SYSTEMD=ACK_NONPRODUCTION`、`M2_SYSTEMD_ALPHA_ROOT`、`M2_SYSTEMD_RUNTIME` 后执行。测试不安装 / reload unit；CLI 退出与真实终端断线、重启是不同能力，分别取证。

## 诊断与运输

```text
<approved-node> <alpha-package>/lib/diagnostics-cli.mjs --root <alpha-root> --output <new-json>
node <independently-trusted-verifier>/verifier.mjs --directory <candidate-directory> --trust <approved-alpha-policy.json>
```

状态诊断只打开现存 Alpha SQLite。任何 journal / WAL / SHM 都返回明确 UNKNOWN，不使用 immutable=1、不启动恢复。一个 Node 进程内的短 worker thread 提供超时隔离，减少第二个 Node 的基础内存；45 秒、128 MiB、64 KiB 输出预算保持不变。JS worker 的 heap 限制不是内核 RSS 硬限制；RSS / 时限实测与未测项见验收。主机 Docker / Compose / systemd 诊断继续使用 [M1 独立包](../deployment-v2-m1/README.md)，两种报告的覆盖范围不相同。

读取和新报告的写入 / fsync 均受主线程 watchdog 覆盖。报告中的 durationMs 截止采集 / 序列化阶段，测量工具另记包含发布的 CLI wallMs。必须核对退出码、scope 和 Schema；输出文件存在不代表采集完整、预算通过或具备生产资格。

离线目录只有 `release.json`、64 字节 `release.sig` 和列明的 `payload/` 文件。AGENT / APPLICATION 使用不同路径白名单。签名验证器的代码和信任政策必须先独立建立信任，不能先运行候选包。默认拒绝 TEST_ONLY key；测试需显式 `--allow-test-key`，且所有包、政策和输出均限定 NONPRODUCTION_ALPHA。固定密钥签名不能冒充真实 CI provenance；生产签名根没有配置。

## 验证入口

```text
node scripts/run-bounded.mjs --label m2-tests --timeout-seconds 55 --idle-seconds 45 -- node --test --test-concurrency=1 deployment-v2-agent/tests/*.test.mjs
node deployment-v2-agent/tools/run-local-linux.ts --suite m1
node deployment-v2-agent/tools/run-local-linux.ts --suite m2
node deployment-v2-agent/tools/run-local-linux.ts --suite measure
node deployment-v2-agent/tools/measure.ts --output work/deployment-v2-m2/new-measurement.json
```

本地 Docker 入口只访问 Windows Docker Desktop 的固定本机管道。测试镜像以 digest 固定，`--pull=never`、无网络、普通用户、源只读、独立临时文件系统；只允许清理本次随机命名并匹配标签的测试容器。没有 Docker-in-Docker、宿主 Docker socket mount 或生产资源。

[外部 Linux workflow](../.github/workflows/deployment-v2-agent.yml) 提供真实 Linux / Compose 入口；只读仓库权限、无生产凭据、不上传原始证据。workflow 定义、本地 Docker Linux 与实际远端 CI run 分开报告。M1 全部测试保留；没有真实外部 run 的项目继续 NOT_RUN。
