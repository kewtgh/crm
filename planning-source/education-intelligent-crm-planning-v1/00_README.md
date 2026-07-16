# Education Relationship CRM 规划与Schema交付包

## 1. 包含内容

| 文件 | 内容 |
|---|---|
| `01_PRD.md` | 完整产品需求、业务规则、非功能需求、MVP边界和指标 |
| `02_PAGE_INFORMATION_ARCHITECTURE.md` | 一级导航、页面、路由、Tab、列表字段、筛选和交互 |
| `03_DATA_MODEL_AND_POSTGRESQL_DESIGN.md` | 领域模型、聚合边界、历史策略、多租户、搜索和事务设计 |
| `04_ENGINEERING_TASK_PLAN.md` | Phase 0—8、Epic、任务、依赖和验收标准 |
| `05_ACCEPTANCE_CRITERIA.md` | MVP上线验收清单 |
| `06_SEED_DICTIONARIES.md` | 初始课程、职位、Pipeline、权限和质量规则建议 |
| `prisma/schema.prisma` | Prisma ORM 7风格主Schema |
| `prisma.config.ts` | Prisma配置示例 |
| `prisma/migrations/0001_domain_constraints.sql` | PostgreSQL扩展、CHECK、部分唯一索引和搜索索引 |
| `docs/ERD.mmd` | Mermaid核心关系图 |
| `.env.example` | PostgreSQL连接字符串示例 |
| `package.json` | Prisma格式化、校验和迁移脚本示例 |

## 2. 推荐阅读顺序

1. PRD；
2. 页面信息架构；
3. 数据模型说明；
4. Schema与原生SQL；
5. 工程任务计划；
6. 验收和初始字典。

## 3. Schema使用方式

```bash
npm install
cp .env.example .env
npm run prisma:format
npm run prisma:validate
npm run prisma:migrate:create
```

然后：

1. 审查Prisma生成的create-only migration；
2. 将`prisma/migrations/0001_domain_constraints.sql`中的内容合并到生成的migration末尾；
3. 在临时数据库执行迁移；
4. 运行集成测试；
5. 再部署到Staging。

## 4. 重要说明

- 这是可进入工程评审的V1设计，不是已经运行过生产迁移的成品应用。
- Schema已执行文本结构、定义重复、关系命名配对和括号平衡检查。
- 当前环境未能下载Prisma Schema Engine，因此交付前未完成真实`prisma validate`和PostgreSQL迁移执行；项目安装依赖后必须执行上述命令。
- PostgreSQL补充SQL假设Prisma已先创建对应表；不要把该文件单独作为第一条迁移直接执行。
- 正式开发前应使用匿名真实样本确认字段、字典、权限和Pipeline。
- 未成年人和家庭数据的保留期限、同意机制和跨境存储要求需要根据实际运营地区做法律评审。

## 5. 建议第一阶段实施范围

首个可用版本优先完成：

1. Workspace、用户、团队、权限和审计；
2. 学校、部门、Person和任职历史；
3. 家庭、学生、监护关系和学籍；
4. Lead、Opportunity、Activity和Task；
5. CSV/XLSX导入；
6. 学生自动升年级；
7. 基础报告；
8. AI提取与摘要基础版。

不建议在上述领域关系稳定前优先开发高级AI、开放式报表或外部门户。
