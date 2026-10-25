# M1 应用制品运输比较

2026-10-25。结论：M2 优先验证“现有 CI 产出离线包 → 管理员使用既有文件渠道传入 → 独立验证”的候选。尚未固定真实应用包格式或可用传输渠道，不能声称真实应用运输通过。不新增生产 Registry、服务器或构建服务。

## 现有资源与结果

| 方式 | 已有证据 / 本次验证 | 实际渠道结果 | M2 必要条件 |
| --- | --- | --- | --- |
| 现有 CI artifact | 仓库存在托管 Actions 与受限、脱敏 QA artifact 机制；没有因此获得应用 OCI 发行包。只读查询的历史 CI 成功属于旧应用提交 | NOT_RUN，新 M1 workflow 未推送执行；未发布 / 下载真实应用镜像包 | 冻结无生产凭据的应用打包、最小发布证据、期限 / 大小 / 身份政策，独立于 QA 原始证据 |
| 管理员已有文件传递 | 本地文件验证算法 PASS：签名、身份字段、内容图、篡改拒绝；临时测试密钥和独立虚构 OCI 输入 | NOT_RUN，未使用真实管理员通道或生产文件 | 管理员确认现有渠道，先在外部传递受审包；导入后不依赖 CI 在线，不运行包内自证脚本 |
| 已获准 Registry | 没有收到获准 endpoint / policy / 离线信任材料；没有网络探测、推送或登录 | NOT_RUN，不推定存在或不存在 | 若管理员已有且允许使用，再验证精确 digest、身份、权限与下载预算；不能为填表新建服务 |

历史应用 CI 的只读元数据见 [run 40172579587](https://github.com/kewtgh/crm/actions/runs/40172579587)，head `926819e566c5736e83817cd55e45dbf3e5337e66`。它不包含设计基线之后的 M1 代码，不能用于本阶段 Linux 或运输认证。

## 已执行的独立验证器

[transport.ts](../../../deployment-v2-m1/src/transport.ts) 使用 Node 内置 Ed25519 校验精确 manifest 字节与外置 trust policy，限定 repository ID、issuer、workflow / ref、source commit、平台。输入为临时生成密钥、`example.invalid` 身份和小型 OCI layout；私钥不落盘、不入 Git。字段可做密码学绑定，不证明这些字段真由实际 CI 发布，结果明确为 `EPHEMERAL_TEST_KEY_ONLY` / `productionCiProvenance=NOT_RUN`。

验证器检查 layout / index / manifest / config / layer descriptor 图、SHA-256、size、平台、未列对象和安全文件类型。gzip 流解压仅计算 diff ID，不解包到文件系统、不运行 tar hook；超量 / 超时停止。manifest digest 与 config digest 分开记录，config rootfs diff IDs 与层内容绑定。来源依据是 [OCI image manifest 规范](https://github.com/opencontainers/image-spec/blob/main/manifest.md)。

5 项本地原生测试通过，包括签名主体 / 信任身份错误、内容篡改、未列对象、预算拒绝与压缩层关联。测量 fixture 为 1024 字节空 tar，OCI 对象合计 796 字节，验证约 16 ms；这些数量只证明算法路径，不代表真实镜像体积或导入性能。

单对象 16 MiB、解压总内容 8 MiB、单层 5 秒、最多固定少量对象是实验护栏，不是生产镜像上限。尚无正式 archive 安全解包、Sigstore / OIDC provenance、撤销策略、Docker load、实际运行 image ID / rootfs 与已验内容的绑定。M0 的正式来源与离线 attestation 门槛保持不变。

## 磁盘与运输门槛

实验没有网络、下载、解包 scratch 或 Docker load。`additionalDiskLowerBoundBytes=1820` 是 796 字节 OCI layout / index / manifest / config / 压缩层加 1024 字节内容的算法下界，未计外部签名 / trust 元数据、文件系统分配、运输 archive 开销、Docker 层及现有缓存，不能作为生产 free-space 准入数值。

M2 必须冻结一个可实际传递的签名运输格式及大小计算；M3 在目标包线非生产 Rootless daemon 中验证 load 前后内容身份、压缩 / 解压峰值、Docker 新增 D、暂存 A / U、安全余量 R、失败时的证据留存。没有真实 D 测量则运输兼容为 NOT_RUN，不回退到生产构建、npm ci 或 Buildx。
