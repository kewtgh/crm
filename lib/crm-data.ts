export type StatusTone = "green" | "amber" | "red" | "blue" | "gray" | "purple";

export type DataRow = {
  id: string;
  primary: string;
  secondary: string;
  owner: string;
  status: string;
  statusTone: StatusTone;
  meta: string;
  extra: string;
  completeness: number;
};

export type ModuleConfig = {
  key: string;
  eyebrow: string;
  title: string;
  description: string;
  singular: string;
  primaryColumn: string;
  secondaryColumn: string;
  metaColumn: string;
  extraColumn: string;
  addLabel: string;
  searchPlaceholder: string;
  rows: DataRow[];
};

const owners = ["Olivia Chen", "Jason Wu", "Sophia Lin", "Ethan Wang"];

export const moduleConfigs: Record<string, ModuleConfig> = {
  schools: {
    key: "schools",
    eyebrow: "RELATIONSHIP NETWORK",
    title: "学校与机构",
    description: "查看学校组织、关键人覆盖和关系健康度。",
    singular: "学校",
    primaryColumn: "学校 / School",
    secondaryColumn: "城市 · 课程",
    metaColumn: "关键人覆盖",
    extraColumn: "最近联系",
    addLabel: "新建学校",
    searchPlaceholder: "搜索学校中文名、英文名、城市…",
    rows: [
      ["s1", "上海惠灵顿外籍人员子女学校", "Wellington College International Shanghai", "上海 · IB / IGCSE", "健康", "green", "5 / 6 已覆盖", "今天 10:24", 92],
      ["s2", "台北欧洲学校", "Taipei European School", "台北 · IB / A-Level", "需关注", "amber", "3 / 6 已覆盖", "2 天前", 78],
      ["s3", "新加坡美国学校", "Singapore American School", "新加坡 · AP", "健康", "green", "6 / 6 已覆盖", "昨天", 96],
      ["s4", "北京鼎石学校", "Keystone Academy", "北京 · IB / 双语", "发展中", "blue", "4 / 6 已覆盖", "5 天前", 84],
      ["s5", "香港汉基国际学校", "Chinese International School", "香港 · IB", "需关注", "amber", "2 / 6 已覆盖", "12 天前", 69],
      ["s6", "深圳国际交流书院", "Shenzhen College of International Education", "深圳 · A-Level", "健康", "green", "5 / 6 已覆盖", "3 天前", 90],
      ["s7", "苏州新加坡外籍人员子女学校", "Suzhou Singapore International School", "苏州 · IB", "风险", "red", "1 / 6 已覆盖", "28 天前", 54],
      ["s8", "广州美国人国际学校", "American International School of Guangzhou", "广州 · IB", "发展中", "blue", "4 / 6 已覆盖", "6 天前", 82],
      ["s9", "德威国际学校（浦东）", "Dulwich College Shanghai Pudong", "上海 · IB / IGCSE", "健康", "green", "5 / 6 已覆盖", "昨天", 94],
      ["s10", "杭州国际学校", "Hangzhou International School", "杭州 · IB", "待验证", "gray", "2 / 6 已覆盖", "18 天前", 63],
      ["s11", "南京国际学校", "Nanjing International School", "南京 · IB", "发展中", "blue", "3 / 6 已覆盖", "8 天前", 76],
      ["s12", "青苗学校", "Beanstalk International Bilingual School", "北京 · IB / 双语", "健康", "green", "5 / 6 已覆盖", "4 天前", 88],
    ].map((r, index) => row(r, owners[index % owners.length])),
  },
  people: {
    key: "people",
    eyebrow: "UNIFIED PERSON RECORDS",
    title: "人员与联系人",
    description: "同一人只保留一份档案，身份与任职按时间记录。",
    singular: "联系人",
    primaryColumn: "姓名 / Name",
    secondaryColumn: "当前身份",
    metaColumn: "联系方式",
    extraColumn: "最近互动",
    addLabel: "新建联系人",
    searchPlaceholder: "搜索中文名、英文名、邮箱、手机…",
    rows: [
      ["p1", "王若晴", "Rachel Wang", "升学指导主任 · 台北欧洲学校", "活跃", "green", "rachel.wang@tes.edu", "今天", 94],
      ["p2", "周子谦", "Leo Chou", "家长 · 付款人", "待跟进", "amber", "+886 912 668 205", "3 天前", 82],
      ["p3", "李映雪", "Iris Li", "招生主任 · 上海惠灵顿", "活跃", "green", "iris.li@wellingtoncollege.cn", "昨天", 91],
      ["p4", "陈守仁", "Ryan Chen", "家长 · 法定监护人", "已验证", "blue", "ryan.chen@example.com", "5 天前", 88],
      ["p5", "徐嘉敏", "Jasmine Hsu", "客户成功 · 国际学校", "活跃", "green", "jasmine.hsu@lumina.edu", "今天", 96],
      ["p6", "林俊佑", "Jay Lin", "学生 · IB Year 1", "受保护", "purple", "监护人可见", "2 天前", 86],
      ["p7", "何明哲", "Marcus Ho", "校长 · 苏州新加坡学校", "任职待确认", "red", "marcus.ho@ssis.edu", "31 天前", 67],
      ["p8", "张诗涵", "Sienna Zhang", "家长 · 主要联系人", "活跃", "green", "+86 138 6620 9183", "昨天", 90],
      ["p9", "吴天乐", "Theo Wu", "学生 · A2", "受保护", "purple", "监护人可见", "7 天前", 79],
      ["p10", "黄伟诚", "Vincent Huang", "采购经理 · 香港汉基", "待跟进", "amber", "vincent.huang@cis.edu.hk", "14 天前", 74],
    ].map((r, index) => row(r, owners[index % owners.length])),
  },
  students: {
    key: "students",
    eyebrow: "STUDENT JOURNEYS",
    title: "学生档案",
    description: "课程、年级、目标与家庭关系保持连续历史。",
    singular: "学生",
    primaryColumn: "学生 / Student",
    secondaryColumn: "学校 · 课程",
    metaColumn: "申请目标",
    extraColumn: "关键节点",
    addLabel: "新建学生",
    searchPlaceholder: "搜索学生中英文姓名、学校、年级…",
    rows: [
      ["st1", "林俊佑", "Jay Lin", "台北欧洲学校 · IB Year 1", "正常", "green", "2027 · 英国 / 经济", "EE 选题 · 7 天", 86],
      ["st2", "吴天乐", "Theo Wu", "深圳国际交流书院 · A2", "高优先", "red", "2026 · 英国 / 工程", "UCAS · 3 天", 92],
      ["st3", "陈语彤", "Avery Chen", "上海惠灵顿 · IGCSE Y11", "需关注", "amber", "2028 · 美国 / 未定", "选课确认 · 12 天", 78],
      ["st4", "周宇恒", "Evan Chou", "北京鼎石 · IB Year 2", "正常", "green", "2026 · 加拿大 / CS", "Offer 决策 · 5 天", 95],
      ["st5", "张若熙", "Rosie Zhang", "香港汉基 · MYP 5", "资料缺失", "amber", "2029 · 多国 / 艺术", "补全成绩", 61],
      ["st6", "王奕辰", "Aiden Wang", "新加坡美国学校 · Grade 11", "正常", "green", "2027 · 美国 / 商科", "SAT · 18 天", 89],
      ["st7", "何雨乔", "Mia Ho", "杭州国际学校 · IB Year 1", "升级待确认", "blue", "2027 · 澳大利亚 / 生物", "年级确认", 73],
      ["st8", "许安然", "Anya Hsu", "广州美国人学校 · Grade 10", "正常", "green", "2028 · 美国 / 心理", "活动规划 · 9 天", 84],
      ["st9", "刘柏翰", "Bryan Liu", "南京国际学校 · MYP 5", "需关注", "amber", "2029 · 英国 / 未定", "监护人沟通", 70],
    ].map((r, index) => row(r, owners[index % owners.length])),
  },
  households: {
    key: "households",
    eyebrow: "FAMILY CONTEXT",
    title: "家庭与监护关系",
    description: "以家庭为长期主体，明确监护、付款与决策角色。",
    singular: "家庭",
    primaryColumn: "家庭 / Household",
    secondaryColumn: "学生",
    metaColumn: "主要联系人",
    extraColumn: "最近沟通",
    addLabel: "新建家庭",
    searchPlaceholder: "搜索家庭、学生或监护人…",
    rows: [
      ["h1", "林氏家庭 · Taipei", "Lin Household", "林俊佑 · 1 名学生", "服务中", "green", "林美琪 / 母亲", "2 天前", 91],
      ["h2", "吴氏家庭 · Shenzhen", "Wu Household", "吴天乐 · 1 名学生", "高优先", "red", "吴文凯 / 父亲", "今天", 95],
      ["h3", "陈氏家庭 · Shanghai", "Chen Household", "陈语彤 · 2 名学生", "咨询中", "blue", "陈守仁 / 父亲", "5 天前", 82],
      ["h4", "周氏家庭 · Beijing", "Chou Household", "周宇恒 · 1 名学生", "服务中", "green", "周子谦 / 父亲", "3 天前", 88],
      ["h5", "张氏家庭 · Hong Kong", "Zhang Household", "张若熙 · 1 名学生", "资料缺失", "amber", "张诗涵 / 母亲", "昨天", 66],
      ["h6", "王氏家庭 · Singapore", "Wang Household", "王奕辰 · 2 名学生", "服务中", "green", "王慧敏 / 母亲", "4 天前", 90],
      ["h7", "何氏家庭 · Hangzhou", "Ho Household", "何雨乔 · 1 名学生", "验证中", "amber", "何明哲 / 父亲", "8 天前", 72],
    ].map((r, index) => row(r, owners[index % owners.length])),
  },
  leads: {
    key: "leads",
    eyebrow: "QUALIFICATION FLOW",
    title: "线索管理",
    description: "线索转化前先查重、预览并明确下一步。",
    singular: "线索",
    primaryColumn: "线索 / Lead",
    secondaryColumn: "来源 · 类型",
    metaColumn: "产品意向",
    extraColumn: "下一步",
    addLabel: "新建线索",
    searchPlaceholder: "搜索线索、学校、家庭、来源…",
    rows: [
      ["l1", "台中常春藤高中合作", "Ivy Collegiate Academy", "校友推荐 · 学校", "已联系", "blue", "升学规划项目", "明天 14:00", 78],
      ["l2", "赵氏家庭咨询", "Zhao Household", "官网 · 家庭", "新线索", "purple", "IB 学术规划", "今天 16:30", 70],
      ["l3", "曼谷国际学校合作", "Bangkok International School", "活动 · 学校", "培育中", "amber", "教师工作坊", "3 天后", 82],
      ["l4", "郑同学申请咨询", "Alex Cheng", "家长转介 · 学生", "已确认", "green", "美国本科申请", "周五", 90],
      ["l5", "马来西亚家庭咨询", "Lim Household", "社交媒体 · 家庭", "待验证", "gray", "A-Level 选课", "等待回复", 58],
      ["l6", "成都双语学校合作", "Chengdu Bilingual School", "展会 · 学校", "已联系", "blue", "升学指导外包", "下周一", 76],
    ].map((r, index) => row(r, owners[index % owners.length])),
  },
  tasks: {
    key: "tasks",
    eyebrow: "WORK MANAGEMENT",
    title: "任务与日历",
    description: "让每次有效沟通都落到清晰、可追踪的下一步。",
    singular: "任务",
    primaryColumn: "任务 / Task",
    secondaryColumn: "关联对象",
    metaColumn: "负责人",
    extraColumn: "截止时间",
    addLabel: "新建任务",
    searchPlaceholder: "搜索任务、客户或负责人…",
    rows: [
      ["t1", "确认 UCAS 推荐信终稿", "Theo Wu · 学生", "今天到期", "red", "Sophia Lin", "今天 17:00", 100],
      ["t2", "台北欧洲学校续约回访", "Taipei European School", "进行中", "blue", "Olivia Chen", "明天 10:30", 100],
      ["t3", "补全张若熙学术成绩", "Rosie Zhang · 学生", "待处理", "amber", "Jason Wu", "7 月 19 日", 100],
      ["t4", "审核赵氏家庭监护资料", "Zhao Household", "待验证", "purple", "Ethan Wang", "7 月 20 日", 100],
      ["t5", "准备深圳国际交流报价", "School Opportunity", "进行中", "blue", "Olivia Chen", "7 月 21 日", 100],
      ["t6", "确认何雨乔升年级例外", "Mia Ho · 学生", "待审批", "amber", "Sophia Lin", "7 月 22 日", 100],
      ["t7", "更新香港汉基关键人", "Chinese International School", "逾期", "red", "Jason Wu", "昨天", 100],
    ].map((r, index) => row(r, owners[index % owners.length])),
  },
};

function row(values: (string | number)[], owner: string): DataRow {
  return {
    id: String(values[0]),
    primary: String(values[1]),
    secondary: `${values[2]} · ${values[3]}`,
    owner,
    status: String(values[4]),
    statusTone: values[5] as StatusTone,
    meta: String(values[6]),
    extra: String(values[7]),
    completeness: Number(values[8]),
  };
}

export const crmUsers = [
  { id: "u1", name: "陈雅雯", english: "Olivia Chen", team: "上海 · 管理", role: "ADMIN", accounts: 28, status: "活跃", last: "今天 09:42", mfa: true },
  { id: "u2", name: "吴俊杰", english: "Jason Wu", team: "台北 · 销售", role: "SALES", accounts: 34, status: "活跃", last: "昨天 18:05", mfa: true },
  { id: "u3", name: "林书妍", english: "Sophia Lin", team: "新加坡 · 客户成功", role: "OPERATIONS", accounts: 22, status: "活跃", last: "今天 08:20", mfa: true },
  { id: "u4", name: "王以恒", english: "Ethan Wang", team: "上海 · 运营", role: "OPERATIONS", accounts: 19, status: "休假", last: "7 月 12 日", mfa: true },
  { id: "u5", name: "郑宇翔", english: "Alex Cheng", team: "台北 · 销售", role: "SALES", accounts: 0, status: "待激活", last: "尚未登录", mfa: false },
  { id: "u6", name: "陈芷涵", english: "Hannah Chen", team: "新加坡 · 销售", role: "SALES", accounts: 16, status: "活跃", last: "2 天前", mfa: true },
];
export const guardians = [
  { id: "g1", name: "赵嘉敏", english: "Maggie Zhao", email: "maggie.zhao@example.com", student: "赵子墨 / Ethan Zhao", match: "学籍 + 手机", submitted: "今天 10:12", risk: "低" },
  { id: "g2", name: "林宏达", english: "Howard Lin", email: "howard.lin@example.com", student: "林俊佑 / Jay Lin", match: "学生邀请码", submitted: "今天 09:18", risk: "低" },
  { id: "g3", name: "黄婉如", english: "Wendy Huang", email: "wendy.h@example.com", student: "黄思齐 / Riley Huang", match: "仅姓名匹配", submitted: "昨天 16:45", risk: "中" },
  { id: "g4", name: "周明轩", english: "Mason Chou", email: "mason.chou@example.com", student: "周宇恒 / Evan Chou", match: "学籍 + 邮箱", submitted: "昨天 14:22", risk: "低" },
  { id: "g5", name: "吴欣怡", english: "Cindy Wu", email: "cindy.wu@example.com", student: "吴天乐 / Theo Wu", match: "资料冲突", submitted: "7 月 14 日", risk: "高" },
  { id: "g6", name: "张诗涵", english: "Sienna Zhang", email: "sienna.z@example.com", student: "张若熙 / Rosie Zhang", match: "学籍 + 证件", submitted: "7 月 14 日", risk: "低" },
];
