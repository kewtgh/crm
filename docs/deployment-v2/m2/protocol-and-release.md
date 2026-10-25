# M2 Alpha 状态、生命周期与离线运输协议

版本 `0.2.0-alpha.1`。这是 M0 v0.2 的离线 Alpha 子集，不重定义正式应用发布状态机。唯一任务为 `FICTIONAL_CHECKPOINT`：延迟 0–5000 ms 后在专属 Alpha 根目录排他写一份虚构 receipt。没有应用迁移、Docker 激活、业务接受或升级 hook。

## 单一状态与事务

| 表 | 事实与约束 |
| --- | --- |
| `store_meta` / `site` | epoch / protocol=1、Alpha scope、Agent digest、owner epoch=1、site revision；accepted_application 强制 NULL |
| `operations` | 不可变请求 / 计划 hash、唯一 idempotency key、revision CAS；最多一个未解决操作 |
| `grants` | EXECUTE / RECONCILE、绑定 operation / expected revision / plan digest / Agent digest；READY → CONSUMED 不可重置；至多一个 READY |
| `steps` | NOT_STARTED → INTENT → PROVEN / UNKNOWN；PROVEN 不可覆盖；step ID 不复用为新执行 |
| `evidence` | 内联最小化 typed receipt / UNKNOWN 观测，摘要引用、不可修改；不是第二套状态 |
| `events` | 和 projection 同事务的递增事件；不会独立触发任务 |

写入固定 DELETE journal、synchronous EXTRA、foreign keys、短 BEGIN IMMEDIATE、1500 ms busy timeout；Linux 一律先取固定内核 flock 再进入 SQLite。锁文件不删建、不设 lease。Alpha state 准入上限 8 MiB 并保留结果空间；最多 128 个操作、每操作 16 个恢复 grant，超限拒绝而不自动清理。

请求字段固定为 `protocolVersion`、`idempotencyKey`、`plan`、`planDigest`。计划固定任务 kind、site ID、expected site revision、owner epoch、Agent digest、delay、nonce 和最多五分钟有效期。字段白名单拒绝 shell、任意路径、unit 属性或升级声明。同 key 同内容找回原操作，不重发 grant；同 key 不同内容、陈旧 revision、旧 Agent 或过期新计划拒绝。

状态为 QUEUED → PREPARING → COMPLETED；结果不明进入 RECOVERY_REQUIRED，未领取且已过期可 REJECTED。没有 ACCEPTED 应用状态。领取 EXECUTE 与 INTENT 同事务提交，随后才做文件效果；SQLite 提交不能证明文件效果，文件存在也不能证明完成事务已提交。

receipt 只承认 FICTIONAL_ONLY、原 operation / step / invocation / plan / Agent 绑定。完成事务一起写 PROVEN、evidence、COMPLETED、site revision 和 event。文件效果已发生、SQLite 完成失败时保留真实文件和旧 INTENT；显式 RECONCILE 生成新一次性观测授权，核实旧执行者已结束，再读取原文件，绝不重新执行 checkpoint。

无 receipt 只表示 UNKNOWN，不自动解释为 NO_EFFECT。超时、进程退出、内核锁释放、service inactive 或重复 worker 都不能重置 grant。Windows 只能保守探测 PID；Linux 同时记录 boot / PID start ticks / invocation，避免将复用 PID 误判为原执行者。执行身份只保存在私有状态，不导出到诊断。

只读接口不取写锁、不创建空库、不改 journal_mode、不使用 immutable=1。存在 journal / WAL / SHM 就拒绝打开 SQLite并报告 STATE_RECOVERY_REQUIRED；支持表 / epoch 不符、损坏库、权限不足、缺失库和 aliased file 分别分类。显式持锁 writer 才可能进行 SQLite 自身恢复，不能据此重放外部任务。

## 按需生命周期

准入事务与 systemd 派发不是一个原子操作。已准入但 CLI 退出前未派发仍是 QUEUED，用户可以找回原 key 后显式派发。派发成功只表示 ENQUEUED；实际任务结果读 SQLite。

固定 user unit 名称 `lumina-crm-deployment-v2-alpha.service`。unit 先以 `/usr/bin/flock --nonblock --exclusive --no-fork` 获同一项目锁，再执行包内固定 Node / worker；避免正常 unit 多留一个 Node 锁代理。CLI 手动调用的 Linux 包装进程仅短期等待，不能成为常驻 guardian。

unit 的 root / payload 路径仅由受审 Alpha 初始化与渲染确定，不来自任务请求。派发核对固定用户、FragmentPath、字节 hash、无 drop-in、NeedDaemonReload=no。没有 sudo、systemd-run 任意属性、unit install / enable / reload、自动重启或开机自动发布。

已实测的进程 kill / Unix SIGTERM 和 SQLite rollback 不能替代真实 manager / 会话断线 / cgroup / reboot。M2 只提供现有非生产 fixed unit 的 opt-in 入口，这些系统能力未执行就保留 NOT_RUN。

## 离线目录 v1

候选格式固定 `lumina.offline-directory.v1`，没有 tar 解包器或可执行安装钩子：

```text
release.json       # 精确 UTF-8 字节的签名主体
release.sig        # 原始 64 字节 Ed25519 签名
payload/
```

manifest 严格列 format / scope / kind / version / source / platform / agentProtocol / storeEpoch / files / oci。固定 repository ID、issuer、workflow，精确 commit 和对应角色 tag；外置 Alpha trust policy 固定公钥、source commit 和 key usage。未知字段、额外内容、路径穿越、符号链接、硬链接和外部 blob URL 均拒绝。

| 角色 | 内容与兼容检查 |
| --- | --- |
| AGENT | 私有 Node、同包 JavaScript、runtime-manifest；Node 24.22.1、Windows / Linux x64、protocol / store epoch=1、精确文件摘要；不读取应用 package.json |
| APPLICATION | 仅 OCI layout / index / blobs；Linux amd64、manifest / config / 压缩层 / diff ID 内容图；不 load、不运行镜像、不改 Agent |

manifest 最多 64 KiB、48 文件 / 96 目录项；Agent payload 最多 384 MiB，应用实验包最多 128 MiB；OCI 最多 16 层、解压内容 256 MiB、单层最多 5 秒、验证总 deadline 10 秒。文件 hash 流式 64 KiB buffer，遇到未列目录项立即停止。软件时限不代替磁盘故障 / 内核 I/O 挂起认证。

M2 的 Ed25519 证明固定密钥签署了这些声明，不能单独证明 GitHub CI 真正构建。结果明确 `PINNED_KEY_SIGNED_CLAIMS_ONLY / ciProvenance=NOT_RUN`。TEST_ONLY 默认拒绝，显式测试标志也不能把 scope 改成生产；不分发默认生产 key、测试私钥或生产 trust root。正式 Sigstore / OIDC、撤销策略、SBOM、安装 / 回退和 root-owned 权限链仍按 M0 门槛验收。

独立 verifier 先从可信代码与运行时建立信任，再读取候选包；不会调用候选 CLI 自证。运行时的自校验用于发现已建立信任后漂移，不能替代首次来源认证。M2 没有安装器、active pointer 切换或业务发布；以上限制不授权生产运行。
