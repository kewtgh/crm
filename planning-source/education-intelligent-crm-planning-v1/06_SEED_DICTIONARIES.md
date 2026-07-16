# 建议初始数据字典 V1.0

本文件用于首轮业务评审与`prisma/seed.ts`实现，不代表不可修改的硬编码。

## 1. 课程体系 Curriculum

| Code | 名称 | 建议年级 |
|---|---|---|
| A_LEVEL | A-Level | AS / A2 或 Year 12 / Year 13 |
| IB_DP | IB Diploma Programme | IB Year 1 / IB Year 2 |
| IB_MYP | IB Middle Years Programme | MYP 1—5 |
| AP | Advanced Placement | Grade 9—12，可按学校配置 |
| IGCSE | IGCSE | Year 10 / Year 11 |
| GCSE | GCSE | Year 10 / Year 11 |
| CN_HIGH_SCHOOL | 中国普通高中 | 高一 / 高二 / 高三 |
| US_HIGH_SCHOOL | 美国高中 | Grade 9 / 10 / 11 / 12 |
| CA_HIGH_SCHOOL | 加拿大高中 | Grade 9 / 10 / 11 / 12 |
| OTHER | 其他 | 管理员配置 |

## 2. 标准职位 Standard Position

### 学校决策层

- BOARD_CHAIR：董事长/举办者
- GROUP_PRINCIPAL：总校长
- PRINCIPAL：校长
- VICE_PRINCIPAL：副校长
- ACADEMIC_PRINCIPAL：学术校长
- INTERNATIONAL_PRINCIPAL：国际部校长

### 招生与升学

- ADMISSIONS_DIRECTOR：招生主任
- UNIVERSITY_COUNSELING_DIRECTOR：升学指导主任
- UNIVERSITY_COUNSELOR：升学指导
- INTERNATIONAL_CURRICULUM_DIRECTOR：国际课程主任

### 教学与学生管理

- GRADE_DIRECTOR：年级主任
- HOMEROOM_TEACHER：班主任
- SUBJECT_HEAD：学科主任
- PSYCHOLOGICAL_COUNSELOR：心理老师
- PARENT_RELATIONS_MANAGER：家校负责人

### 商务与支持

- MARKETING_DIRECTOR：市场负责人
- FINANCE_DIRECTOR：财务负责人
- PROCUREMENT_MANAGER：采购负责人
- ADMINISTRATION_MANAGER：行政负责人

## 3. 组织部门模板

```text
校长办公室
国际部
  国际课程中心
  升学指导中心
招生办公室
学术事务部
年级组
学科组
家校关系
市场部
财务部
采购部
行政部
```

## 4. 学校销售Pipeline

| 顺序 | Code | 阶段 | 默认概率 | 建议必填 |
|---:|---|---|---:|---|
| 10 | PROSPECT | 潜在线索 | 5 | 学校、负责人 |
| 20 | CONTACTED | 已建立联系 | 10 | 首次活动、下一步 |
| 30 | NEED_CONFIRMED | 需求确认 | 25 | 需求摘要、主要联系人 |
| 40 | STAKEHOLDER_COVERAGE | 关键人覆盖 | 40 | 决策角色 |
| 50 | SOLUTION_DISCUSSION | 方案沟通 | 55 | 产品、方案 |
| 60 | QUOTED | 报价 | 70 | 金额、报价文件、预计成交日 |
| 70 | CONTRACT_REVIEW | 合同审批 | 85 | 合同草稿、付款人 |
| 80 | WON | 成交 | 100 | 合同或成交确认 |
| 90 | IMPLEMENTATION | 实施 | 100 | 交付负责人 |
| 100 | RENEWAL | 续约 | 按业务配置 | 续约日期 |
| 999 | LOST | 失败 | 0 | 失败原因 |

## 5. 家庭销售Pipeline

| 顺序 | Code | 阶段 | 默认概率 | 建议必填 |
|---:|---|---|---:|---|
| 10 | NEW | 新线索 | 5 | 家庭/学生、来源 |
| 20 | FIRST_CONTACT | 首次联系 | 10 | 活动、下一步 |
| 30 | NEED_ASSESSMENT | 需求评估 | 25 | 申请年、目标和预算 |
| 40 | FAMILY_DISCUSSION | 家庭沟通 | 40 | 主要联系人、决策人 |
| 50 | RECOMMENDATION | 方案推荐 | 55 | 产品和方案 |
| 60 | TRIAL | 体验 | 65 | 体验安排 |
| 70 | QUOTED | 报价 | 75 | 金额、付款人 |
| 80 | CONSIDERING | 考虑中 | 80 | 顾虑、下一步和截止日期 |
| 90 | WON | 成交 | 100 | 合同或成交确认 |
| 100 | IN_SERVICE | 服务中 | 100 | 顾问和服务计划 |
| 110 | RENEWAL_REFERRAL | 续费/转介绍 | 按业务配置 | 后续机会 |
| 999 | LOST | 失败 | 0 | 失败原因 |

## 6. 核心权限代码建议

- workspace.manage
- users.manage
- teams.manage
- roles.manage
- organizations.read / create / update / delete / merge / export
- people.read / create / update / delete / merge / export
- students.read / create / update / delete / export
- students.sensitive.read
- households.read / create / update / delete / export
- households.sensitive.read
- leads.manage
- opportunities.manage
- financials.read / manage
- activities.manage
- tasks.manage
- imports.create / approve / rollback
- exports.create / sensitive
- reports.generate
- ai.use / configure
- audit.read
- data_quality.manage

## 7. 数据质量规则建议

- ORGANIZATION_MISSING_OWNER
- ORGANIZATION_NO_RECENT_ACTIVITY
- ORGANIZATION_SINGLE_CONTACT_RISK
- ORGANIZATION_MISSING_DECISION_MAKER
- STAFF_ASSIGNMENT_STALE_VERIFICATION
- PERSON_INVALID_PRIMARY_CONTACT
- STUDENT_MISSING_CURRENT_ENROLLMENT
- STUDENT_MISSING_CURRICULUM
- STUDENT_MISSING_GRADE
- STUDENT_MISSING_APPLICATION_YEAR
- STUDENT_NO_PRIMARY_GUARDIAN
- STUDENT_PROGRESSION_RULE_MISSING
- LEAD_MISSING_NEXT_ACTION
- OPPORTUNITY_STALE
- OPPORTUNITY_MISSING_DECISION_ROLE
- POSSIBLE_DUPLICATE_PERSON
- POSSIBLE_DUPLICATE_ORGANIZATION
