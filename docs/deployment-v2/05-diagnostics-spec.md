# 生产环境独立只读诊断包规范

协议名：`lumina.deployment.diagnostics`，schema version：1。这里交付的是规范，尚无可在生产执行的 V2 诊断程序。管理员未来可单独取得受审包，在本机运行并手动传出 JSON；Codex 不访问该主机。

## 目的与非目标

诊断需要回答：采集器是否有权看到某个条件；主机是否满足必要运行边界；Agent / V1 处于什么可观测状态；哪些信息缺失。它不应尝试把主机修到“可部署”。诊断结果也不是迁移 / 接受 receipt，不授权恢复或重放。

包独立版本、签名、私有运行时和固定采集清单，不 import CRM checkout、不需要 npm install、不要求可用 Agent。只读指不写业务、控制平面状态、Docker 配置或 systemd；唯一允许的主动持久化写入是管理员指定的新诊断输出文件。由内核、daemon 或系统日志因查询而产生的正常审计记录不属于工具主动写入，也不能承诺整机逐字节不变。

默认无外网访问、无数据库连接、不提权。权限不足就返回 UNKNOWN。不能用自动 sudo、备用 socket、全机扫描或“再试一次修复”扩大范围。

## 生产只读适配的能力边界

P0 只观测管理员声明的既有 CRM UID / socket / data-root、工具版本、user manager / cgroup 条件和固定文件。确切身份来自私有 policy，输出只报告是否匹配，不能借用同机 Rootful daemon、其他项目的数据库 / Temporal 或真实数据验证隔离。

生产禁止测试 VM、QEMU/KVM、DIND、CI Runner、压测、创建测试容器 / 卷、业务数据库连接和 service start / restart / reboot。也不安装 V2、创建 SQLite 状态库、写探针文件、创建自检 grant 或运行 release gate。新 V2 文件 / unit 尚未安装时报告 NOT_INSTALLED；按需 unit 的 inactive 是正常空闲，不据此报告部署器不可用。

配置匹配只证明当前可观察条件，不证明 oneshot 断线保活、单写者、重启恢复、Rootless 限额生效或崩溃持久性。这些能力在报告中固定 NOT_RUN / OUTSIDE_READ_ONLY_SCOPE，独立关联外部 L2 / L3 证据；不能通过在生产启动测试任务补齐。管理员架构声明只标 OPERATOR_DECLARED，不转换成动态测试 PASS。

## 运行与时限约束

拟定接口：`lumina-diagnostics collect --policy <reviewed-local-policy> --output <new-local-json>`，属于待实现名称。policy 仅列项目身份、允许资源及预先受审的本地健康地址，不允许自定义命令。

工具包由管理员事先验证并放在受控路径；collector 不自行下载、解包安装或创建运行服务。需要临时签名诊断包时，由管理员单独准备和收回，其空间纳入预算，不能借“临时”绕过生产只读采集契约。

- 使用干净环境和固定可执行文件路径，禁止继承 `NODE_OPTIONS`、任意 Docker context、代理、Compose env / profile 注入；不读 shell profile。
- 包内 runtime / collector 先校验自身发行清单。Docker / Compose executable 与 plugin 路径必须与受审 policy 对应，不能执行用户可写的未知 plugin。
- 总时限 45 秒，每个子进程通常最多 3 秒，单命令输出最多 256 KiB，JSON 最多 1 MiB；单组失败继续采集独立组，依赖组 NOT_RUN。
- 候选 RSS 上限 128 MiB、顺序采集、无常驻子进程；在非生产 L1 / L2 先测量，不为设置限额新建生产 unit 或调整主机 cgroup。结束后仅保留管理员指定报告。
- 输出新文件必须 exclusive create、0600、父目录可信，拒绝 symlink / overwrite。写入失败返回独立错误，不在 stderr 退回原始观测。
- 默认禁止网络，包括公网健康和 DNS 查询。明确启用 `local-health` 才访问 policy 中的固定 loopback 端点，不跟随重定向，不记录响应正文。独立的 `edge-health` 扩展须由管理员另外指定允许地址，不自动启用。

## 采集白名单

| 组 | 允许的只读来源 | 提取后可保留 | 必须禁止 |
| --- | --- | --- | --- |
| 工具 / OS | 包 manifest；`/etc/os-release` 的允许字段；kernel / architecture | 工具 digest、OS ID / version、架构、kernel version | hostname、machine-id、boot-id、DMI、全量 uname |
| 软件版本 / 来源 | 固定 `dpkg-query` 包集合；固定 Docker / Compose / Buildx version | 包名、发行 revision、语义版本、已核实 build 类型 | `apt update/install`、全包列表、仓库凭据 / URL、任意命令 |
| 身份 / 文件 | policy 指定文件的 lstat / realpath / owner / mode；固定 rootless socket | 预期 owner 是否匹配、类型 / symlink / mode 是否安全、errno 枚举 | 读取 `.env` / secret 内容、文件内容 hash、真实绝对路径、用户名 / UID 原文 |
| Docker | 对明确固定的项目 socket 执行受限 version / info / inspect 查询 | rootless、cgroup driver / version、data-root 是否匹配、项目资源身份匹配、image digest | 默认 rootful socket、其他 context、全机 ps / inspect、环境数组、mount 源路径、daemon 原始 JSON |
| Compose 模型 | 包内无 secrets 的虚构模型，经真实 config 归一化 | checkId、字段类型 / 是否保留、解析阶段 / 错误码 | 对真实 production compose 执行可导出 secret 的 config、`--environment`、打印模型正文 |
| systemd | policy 中固定项目 unit 的受限 show 属性、项目 user manager 可用性 | LoadState、ActiveState、SubState、NeedDaemonReload、身份 / fragment 是否匹配 | `systemctl cat`、Environment、ExecStart / argv、全量 list-units、start / restart / daemon-reload |
| cgroup | 项目自身固定 cgroup 路径的 controller / limit 文件 | 必要 controller 是否存在 / delegated，限额类别 | 写入 controller、修改 delegate、扫描其他用户 |
| 容量 | policy 预配置目录的 statfs | 可用 / 需要空间的分桶和阈值结果 | 目录遍历、文件名列表、du 全盘、创建 probe 文件 |
| Agent 状态 | 受审 manifest 和 store 的严格只读打开；无需运行 Agent 或 API socket | 包版本、schema epoch、枚举状态、假名关联、NOT_INSTALLED / STATE_RECOVERY_REQUIRED | 创建空库、启动 unit、提交 grant、reconcile、恢复 journal、业务 PG / 其他项目数据库 |
| V1 状态 | 固定文件的受限 parser，只取已知结构字段 | result / migrationState 等枚举、证据是否存在与一致、假名关联 | 导出 request 原文、candidate env、日志 / 堆栈、推断 V2 receipt |
| 可选健康 | 受审 loopback / 明确 opt-in edge | HTTP 类别、身份匹配与 readiness 判定、timeout 类别 | cookies、认证凭据、完整 URL / IP / TLS peer 数据、body、follow redirect |

不执行 `docker exec/run/pull/load/build/up/down/prune`、不进入容器、不触发 PostgreSQL 查询、不调用 V1 可能初始化或改状态的命令。不使用 `buildx inspect --bootstrap`。Buildx 版本仅供环境比对，不因缺少 Buildx 判定 V2 镜像发布不兼容。

status / collector 不更新 last-seen、缓存、事件或 schema；不能为了读取打开热 journal 恢复或启动 oneshot。无法安全只读则 UNKNOWN，不能以改权限、提权或调用旧可写 CLI 作为 fallback。生产只读检查与会写 SQLite 的 reconcile 是不同动作。

发行来源 / 包版本、资源匹配和完整性是不同字段：无法读包来源不等于版本错误；无法读取 socket 不等于 rootless=false。只采集已经授权的项目范围，不能为更完整报告扫描其他项目。

## 规范 JSON 结构

最终实现提供 JSON Schema 2020-12，所有对象 `additionalProperties:false`，自由字符串长度和数组项数均有上限。以下字段表是 v1 的规范基线，示例是独立虚构值，不是生产报告。

| 字段 | 约束 |
| --- | --- |
| `schemaVersion`, `kind` | 固定 1 和 `lumina.deployment.diagnostics` |
| `tool` | version、release digest、policy version；不允许 build machine 信息 |
| `capture` | UTC 时间、durationMs、readOnly=true、networkMode、scope、complete；scope 区分 PRODUCTION_READ_ONLY 与 NONPRODUCTION_TEST |
| `subject` | 每包随机假名；无真实 host / site identity |
| `versions` | 固定组件白名单；每项 status、可公开 version、允许的 package 名 / revision，或 UNKNOWN code |
| `checks` | 至多 128 条；checkId / code / stage / remediationId 为注册枚举，依赖为 checkId 列表 |
| `state` | source 为 SQLITE、V1 或 UNAVAILABLE；枚举状态 / 假名引用，可 NOT_INSTALLED；无原请求或 secret |
| `capabilities` | 固定动态能力 ID、requiredLayer、result、reason；生产采集不执行动态认证，均为 NOT_RUN / OUTSIDE_READ_ONLY_SCOPE |
| `compatibilityCertified` | 生产诊断固定 false；完整认证由外部发行报告与 P0 匹配联合判定 |
| `summary` | PASS / FAIL / UNKNOWN / NOT_RUN 数量、blocking check IDs、partial reason 枚举 |
| `redaction` | profileVersion、pseudonyms=`PER_REPORT`、rawIncluded=false、被省略字段类别的计数 |

每项 check 包含 `status=PASS|FAIL|UNKNOWN|NOT_RUN`、`severity=BLOCKING|WARNING`、`code`、`stage`、`dependsOn`、受 schema 限制的 expected / observed、`exitCode`、`errno`、`durationMs`、`remediationId`。超时、缺权限、解析失败保留具体类别，不包含原始 stderr 或用户输入。

```json
{
  "schemaVersion": 1,
  "kind": "lumina.deployment.diagnostics",
  "tool": {
    "version": "0.1.0-design",
    "releaseDigest": null,
    "policyVersion": 1
  },
  "capture": {
    "at": "2026-10-25T00:00:00Z",
    "durationMs": 1200,
    "readOnly": true,
    "networkMode": "NONE",
    "scope": "PRODUCTION_READ_ONLY",
    "complete": false
  },
  "subject": "host-example-01",
  "versions": [],
  "checks": [
    {
      "checkId": "docker.socket",
      "status": "UNKNOWN",
      "severity": "BLOCKING",
      "code": "SOCKET_PERMISSION_DENIED",
      "stage": "READ_METADATA",
      "dependsOn": [],
      "expected": { "ownerRole": "PROJECT_USER" },
      "observed": { "metadataAvailable": false },
      "exitCode": null,
      "errno": "EACCES",
      "durationMs": 1,
      "remediationId": "REVIEW_PROJECT_SOCKET_ACCESS"
    },
    {
      "checkId": "docker.info",
      "status": "NOT_RUN",
      "severity": "BLOCKING",
      "code": "DEPENDENCY_UNRESOLVED",
      "stage": "OBSERVE_DAEMON",
      "dependsOn": ["docker.socket"],
      "expected": null,
      "observed": null,
      "exitCode": null,
      "errno": null,
      "durationMs": 0,
      "remediationId": "RESOLVE_DEPENDENCY_FIRST"
    }
  ],
  "state": { "source": "UNAVAILABLE" },
  "capabilities": [
    {
      "id": "oneshot.lifecycle",
      "requiredLayer": "L2",
      "result": "NOT_RUN",
      "reason": "OUTSIDE_READ_ONLY_SCOPE"
    },
    {
      "id": "storage.power-loss",
      "requiredLayer": "L3",
      "result": "NOT_RUN",
      "reason": "OUTSIDE_READ_ONLY_SCOPE"
    }
  ],
  "compatibilityCertified": false,
  "summary": {
    "pass": 0,
    "fail": 0,
    "unknown": 1,
    "notRun": 1,
    "blocking": ["docker.socket", "docker.info"],
    "partialReason": "DEPENDENCY_UNRESOLVED"
  },
  "redaction": {
    "profileVersion": 1,
    "pseudonyms": "PER_REPORT",
    "rawIncluded": false,
    "omitted": []
  }
}
```

正式工具必须有受信 releaseDigest，上例 design / null 不构成现场证据。`complete` 只表示计划中的只读采集是否完整，FAIL 仍可 complete；checks 的 UNKNOWN / NOT_RUN 或超时为 partial。summary 只统计 checks；本来就不执行的 capabilities 动态测试另列 NOT_RUN，不能改写成主机缺陷，也不能把 complete 当作完整兼容认证。

## 脱敏与可信度

采用正向提取后重建 JSON，不对任意日志做正则替换后直接导出。原始 stdout 仅留内存、有界解析，用完丢弃；默认不落盘，不在异常中带出。key、enum、version 也必须验证，防止把 secret 塞进版本或错误字符串。

主机名、真实 site / operation / container 名称和 commit 关联按报告内临时随机映射或 HMAC 假名化。每包独立密钥不输出、不跨包复用；没有真实值则不生成假名。不要对 secret、邮箱、私有路径等做简单 hash，低熵值可被反查。artifact digest 仅在受审允许的公共制品范围保留，否则也用报告内引用。

输出文件可另附 SHA-256 供管理员核对传输完整性，digest 不嵌入自身计算范围。该 hash 不证明主机身份或报告真实性。管理员可在受控渠道签名 / 传递；分析侧仍把报告视为受限制的输入，校验 schema、tool release 与 capture 完整性，不根据报告自动运行修复命令。

退出约定：0=采集完整且无 blocking；2=完整但存在 blocking failure；3=部分采集 / 未知阻断；1=工具自身失败或无法安全输出。报告中状态是事实来源，不能把非零退出一律解释为“不兼容”。

## 验收要求

M1 在开发 / 外部 CI 用独立虚构输入测异常、解析器、版本注入和脱敏，在外部 Linux 用文件 / API 观测验证只读性；需要 systemd / Rootless 的部分进入非生产 L2。禁止为了证明只读在生产故意制造故障、做负载或启动新 unit。安全性或预算未实证的 collector 不进入 P0。

Agent 停止、源码不可读、无 user bus、daemon 不可达、无 root 权限、V1 格式未知、数据库完全不可访问时，工具仍应给出有界 partial JSON。原始日志、未脱敏包和管理员实际报告不进入公开仓库或 CI artifact；公开示例仅用独立虚构 fixture。
