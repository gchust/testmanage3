import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * Initial import of "NocoBase 各模块测试进展.xlsx".
 *
 * The workbook is the source of the first release of this tracker: every dimension,
 * feature point and Example missing item it holds is inserted here once so the
 * application starts with the data the team already had. Rows a user has since added,
 * edited or deleted are never overwritten: an existing name or missing-item title is
 * left untouched, and the seed runs once per database.
 */

type ReadinessStatus = 'complete' | 'partial' | 'missing' | 'unspecified';
type ExampleExists = 'yes' | 'no' | 'unspecified';
type FeatureStatus =
  | 'testable'
  | 'developed'
  | 'testCompleted'
  | 'refactoring'
  | 'inProgress'
  | 'deferred'
  | 'unspecified';

interface FeaturePointSeed {
  readonly name: string;
  readonly level: 'dimension' | 'feature';
  readonly dimension: string;
  readonly owner?: string;
  readonly skillsStatus?: ReadinessStatus;
  readonly docsStatus?: ReadinessStatus;
  readonly exampleExists?: ExampleExists;
  readonly exampleFeatureStatus?: ReadinessStatus;
  readonly exampleExpected?: string;
  readonly exampleCurrent?: string;
  readonly status?: FeatureStatus;
  readonly designScore?: number;
  readonly designNote?: string;
  readonly developmentScore?: number;
  readonly developmentNote?: string;
  readonly agentFriendlinessScore?: number;
  readonly agentFriendlinessNote?: string;
  readonly outputQualityScore?: number;
  readonly outputQualityNote?: string;
  readonly remark?: string;
}

interface MissingItemSeed {
  readonly title: string;
  readonly featurePoint: string;
}

const featurePoints: readonly FeaturePointSeed[] = [
  {
    name: '应用安装',
    level: 'dimension',
    dimension: '应用安装',
    remark: '5 个测试大维度之一',
  },
  {
    name: '从 create app 开始，支持不同数据库',
    level: 'feature',
    dimension: '应用安装',
    remark: '应用创建入口需支持不同数据库',
  },
  {
    name: '什么时候 Agent 介入',
    level: 'feature',
    dimension: '应用安装',
    remark: '明确 Agent 介入时机',
  },
  {
    name: '应用部署',
    level: 'dimension',
    dimension: '应用部署',
    remark: '5 个测试大维度之一',
  },
  {
    name: 'build',
    level: 'feature',
    dimension: '应用部署',
  },
  {
    name: 'deploy',
    level: 'feature',
    dimension: '应用部署',
    remark: '功能点划分：手动上传部署、cli 部署',
  },
  {
    name: '回滚',
    level: 'feature',
    dimension: '应用部署',
  },
  {
    name: '启动、重启、停止等',
    level: 'feature',
    dimension: '应用部署',
    remark: '进程生命周期管理',
  },
  {
    name: '应用升级',
    level: 'dimension',
    dimension: '应用升级',
    remark: '5 个测试大维度之一',
  },
  {
    name: '代码更新',
    level: 'feature',
    dimension: '应用升级',
  },
  {
    name: '多环境迁移',
    level: 'feature',
    dimension: '应用升级',
  },
  {
    name: '应用搭建',
    level: 'dimension',
    dimension: '应用搭建',
    exampleFeatureStatus: 'partial',
    exampleExpected:
      'create-app 三模板创建、目录与组合根、插件注册/卸载/更新、Skills 同步、自定义 CLI、dev/build/start/打包/跨平台、页面与子路由/覆盖层、服务生命周期、后台任务与调度、实时、工作流、扩展点（route override / registry）。',
    exampleCurrent:
      '组合根 client/runtime.ts、server/runtime.ts、client/routes.ts；路由与覆盖层最完整（client/routes.ts:33-101、pages/route-overlays/）；3 个应用自有工作流（server/workflows/）；11 个 packages/examples/ 插件示例；scheduler/queue/realtime/service-provider 服务端示例齐全。',
    remark: '状态说明：可以测试（不代表完备）、重构中、进行中、延期',
  },
  {
    name: '数据库',
    level: 'feature',
    dimension: '应用搭建',
    owner: '陈霖',
    skillsStatus: 'missing',
    exampleFeatureStatus: 'partial',
    exampleExpected:
      '迁移 up/down、种子幂等、多连接、外部只读连接、Repository/Query、collections 元数据生成、方言、数据库浏览器、迁移回滚验证、编译清单。',
    exampleCurrent:
      'database/main 迁移+种子；analytics 独立连接（server/config/database.ts、database/analytics/*、server/routes/analytics.ts）；externalCrm 只读 + metadata.json（database/externalCrm/collections/*）；Repository 全能力（app-plugin-repository-example）；Query vs Repository（/numeric-examples）；Database Explorer 设置页；迁移回滚测试。',
    status: 'developed',
    remark: '功能点划分：migration、query、repository、collections',
  },
  {
    name: '认证',
    level: 'feature',
    dimension: '应用搭建',
    owner: '杨洽',
    exampleFeatureStatus: 'partial',
    exampleExpected:
      '登录/登出/注册/忘记/重置、会话持久化与吊销、安装向导、API Keys、路由 guard、SSO、邮件流程。',
    exampleCurrent:
      '登录登出注册、忘记/重置页、auth: guest/required guard、会话存库、API Keys（root 可开 /settings/api-keys）、初始管理员 seed（nocobase/admin123）。',
    status: 'developed',
  },
  {
    name: '授权',
    level: 'feature',
    dimension: '应用搭建',
    owner: '杨洽',
    exampleFeatureStatus: 'partial',
    exampleExpected:
      '权限集/用户管理、页面级/API 级授权、默认访问/共享/限制规则、数据行/字段级、即时生效、未授权语义、审计。',
    exampleCurrent:
      "app-plugin-authorization-example 完整业务演示（4 页 + 字段白名单 + 行 scope + 团队共享 + 三类规则种子；账号 sales_* / AuthzExample123!）；权限集、用户管理、Inspector 均已注册；authz: 'skip' 与页面拒绝可演示。",
    status: 'developed',
  },
  {
    name: '文件',
    level: 'feature',
    dimension: '应用搭建',
    owner: '龚诚',
    exampleFeatureStatus: 'partial',
    exampleExpected:
      '存储盘、文件集合、单/批上传、预览、缩略图、1:1/1:N 关联、访问控制、可复用组件。',
    exampleCurrent:
      '/file-repository 三页（附件上传、头像 1:1、订单 1:N）；预览支持位图/PDF/文本/音视频 + DOCX/XLSX/PPTX 本地渲染；缩略图（前端原图缩放）。',
    status: 'developed',
  },
  {
    name: 'AI 员工',
    level: 'feature',
    dimension: '应用搭建',
    owner: '陈庚扬',
    exampleFeatureStatus: 'partial',
    exampleExpected:
      '插件注册、设置页、员工 CRUD、内置员工、聊天、工具/技能、MCP、放置形态、页面上下文、开箱可跑。',
    exampleCurrent:
      '插件已注册（client/server）；Settings→AI 管理页（Employees/Skills/Tools/Conversations）；开发态 /dev/ai-components/* 组件演示（现在配了 LLM 可真实对话）；内置员工 Atlas。',
    status: 'testCompleted',
    developmentScore: 6.5,
    developmentNote: '74 个场景通过 47、未通过 27',
    agentFriendlinessScore: 6,
    agentFriendlinessNote:
      '资料评分 60/100（80 分算达标）；Agent 能完成主要任务，但有些步骤要自己翻源码或绕路才能走通，这些问题已整理反馈给开发',
    outputQualityScore: 7,
    outputQualityNote:
      '生成的应用能用：开发环境和正式打包后都跑通了真实问答；但正式包第一次不完整（缺个依赖、补上才能启动），代码检查有不少不规范项，也没写自动化测试',
    remark:
      '环境已解决：已把 app/ai-test/config.yml 的 ai.llmServices（dashscope-test：qwen3.7-flash + text-embedding-v4）写入模板 config.yml（gitignored，未改源码）。重启后实测：启动日志 llmServices:1；llmServices:list 正常；ai:listProviderModels 真实调通 DashScope；aiEmployees:list 返回 Atlas。原先“无预置 LLM”属环境问题，不计入模板缺口。',
  },
  {
    name: '知识库',
    level: 'feature',
    dimension: '应用搭建',
    owner: '陈庚扬',
    exampleExists: 'no',
    exampleFeatureStatus: 'missing',
    exampleExpected:
      '插件注册与前置依赖、向量库、Embedding、知识库 CRUD、文档上传/管理、分段、命中测试、Manifest、RAG 绑定。',
    exampleCurrent:
      '开源 Examples 无 example：app-plugin-ai-knowledge-base 已整体移出开源（commit 741d0eba，2026-09-09），Examples 无依赖、无注册、无页面、无配置，git ls-files 为 0。Pro 版本无实例：code-pro 只有 packages/{examples,plugins} + vendor/nocobase3，没有任何应用模板/示例应用；知识库仅有插件包与 /dev/ai-knowledge-base/* 插件内 dev 路由和 fixtures，要跑必须自行注册进新建应用，并配 PGVector + Embedding 模型 + queue。',
    status: 'testCompleted',
    developmentScore: 7.5,
    developmentNote: '108 个场景通过 88、未通过 20',
    agentFriendlinessScore: 6,
    agentFriendlinessNote:
      '资料评分 60/100（80 分算达标）；缺口主要是功能规则和权限说明不清楚，Agent 有些地方要自己翻源码，问题已整理反馈给开发',
    outputQualityScore: 6.5,
    outputQualityNote:
      '应用能用：正式打包后能启动，真实上传文档、检索、问答都跑通；扣分原因：第一次打的正式包缺依赖、旧数据升级和带专业版插件的组合仍走不通、部署后的页面操作还没验收',
    remark: '开源无；Pro 无实例，仅插件包 dev 路由',
  },
  {
    name: '邮件',
    level: 'feature',
    dimension: '应用搭建',
    owner: '陆建浩',
    exampleFeatureStatus: 'partial',
    exampleExpected:
      'SMTP/Resend 配置、真实发送、测试发送、通知日志、收件人解析、邮件模板、业务发送示例、验证/找回密码邮件、工作流邮件节点。',
    exampleCurrent:
      '通知运行时与 Email/IM Provider 定义已注册；/settings/notifications/logs 有常驻“Send test notification”和通知日志；In-app 可走通“发送→收件箱→日志”。',
    status: 'developed',
  },
  {
    name: '多语言',
    level: 'feature',
    dimension: '应用搭建',
    owner: '曾煌尧',
    exampleFeatureStatus: 'partial',
    exampleExpected:
      '双语、切换器、持久化与服务端同步、服务端翻译/回退、默认语言、清单检查、overrides、插值/复数、格式化。',
    exampleCurrent:
      'en-US/zh-CN 双端文件、语言切换器（禁用/隐藏逻辑）、切换持久化+通知服务端、overrides（Examples 独有增量）、插值、Intl 日期数字、i18n:check。',
    status: 'testCompleted',
    developmentScore: 9,
    developmentNote: '51 个场景通过 49、未通过 1，另有 1 个按设计不执行',
    agentFriendlinessScore: 8.5,
    agentFriendlinessNote:
      '资料评分 85/100；扣分在命令写法不统一、默认语言在开发环境怎么生效没讲清，其他都达标',
    outputQualityScore: 8,
    outputQualityNote:
      '应用开发环境和正式环境都验证过：升级模板后正式包能启动，部署后语言切换和缺失文案的回落都正常；扣分原因：打包和代码检查各返工过一次',
  },
  {
    name: '日志',
    level: 'feature',
    dimension: '应用搭建',
    owner: '陈庚扬',
    exampleFeatureStatus: 'partial',
    exampleExpected:
      '级别、输出目标、轮转保留、主动打日志、请求日志、脱敏、运行日志查看、工作流日志、通知日志。',
    exampleCurrent:
      'server/config/logging.ts（file+console+request）；请求日志中间件；工作流节点日志落库 + 运行详情页；通知发送日志设置页；scheduled-log-job 主动打日志。',
    status: 'developed',
    remark: '功能点划分：api 日志、system 日志；存储：本地 storage、线上 hub',
  },
  {
    name: '工作流',
    level: 'feature',
    dimension: '应用搭建',
    owner: '严俊羿',
    status: 'refactoring',
    remark: '功能点划分：DSL',
  },
  {
    name: '通知',
    level: 'feature',
    dimension: '应用搭建',
    owner: '陆建浩',
    status: 'refactoring',
    remark: '功能点划分：config、send',
  },
  {
    name: '队列',
    level: 'feature',
    dimension: '应用搭建',
    owner: '严俊羿',
    status: 'inProgress',
    remark: '异步任务',
  },
  {
    name: '定时任务',
    level: 'feature',
    dimension: '应用搭建',
    owner: '严俊羿',
    status: 'inProgress',
  },
  {
    name: '审计',
    level: 'feature',
    dimension: '应用搭建',
    owner: '龚诚',
    status: 'deferred',
  },
  {
    name: '导入导出',
    level: 'feature',
    dimension: '应用搭建',
    owner: '龚诚',
    status: 'deferred',
  },
  {
    name: '审批',
    level: 'feature',
    dimension: '应用搭建',
    owner: '严俊羿',
    status: 'deferred',
  },
  {
    name: '历史记录',
    level: 'feature',
    dimension: '应用搭建',
    owner: '龚诚',
    status: 'deferred',
    remark: '记录变更 before after',
  },
  {
    name: '备份',
    level: 'feature',
    dimension: '应用搭建',
    owner: '陈霖',
    status: 'deferred',
    remark: '待定',
  },
  {
    name: '应用测试',
    level: 'dimension',
    dimension: '应用测试',
    remark: '5 个测试大维度之一（如何写用例）',
  },
  {
    name: '测试 kit',
    level: 'feature',
    dimension: '应用测试',
    remark:
      '功能点划分：createMockClient、createMockServer、createMockDatabase',
  },
  {
    name: '如何写测试',
    level: 'feature',
    dimension: '应用测试',
    remark: '主要包括业务搭建过程中产生的代码，如何写测试',
  },
];

const missingItemSeeds: readonly MissingItemSeed[] = [
  { title: '① create-app 三模板无运行演示', featurePoint: '应用搭建' },
  {
    title:
      '② plugin:register/unregister/update/inspect 无“注册前→后”演示（所有示例插件均已注册）',
    featurePoint: '应用搭建',
  },
  { title: '③ skills:sync 无端到端演示', featurePoint: '应用搭建' },
  { title: '④ demo greet/app info 等 CLI 无入口', featurePoint: '应用搭建' },
  { title: '⑤ --tar/--target 只停在文档', featurePoint: '应用搭建' },
  {
    title:
      '⑥ client/route-overrides.ts 为空、app-plugin-registry-example 未注册',
    featurePoint: '应用搭建',
  },
  {
    title:
      '⑦ queue/service-provider/realtime 无首页入口（/realtime 需手工拼地址）',
    featurePoint: '应用搭建',
  },
  {
    title:
      '① database/main|analytics 无 collections/ 派生产物，collections:generate --check 无法演示“派生”',
    featurePoint: '数据库',
  },
  {
    title: '② 三个连接全 SQLite，db-mysql/oracle/postgres 有依赖无配置无演示',
    featurePoint: '数据库',
  },
  { title: '③ database-example 只有迁移/种子无界面', featurePoint: '数据库' },
  { title: '④ .manifest.json 编译清单无演示', featurePoint: '数据库' },
  {
    title:
      '① 找回密码未接线——实测 POST /main/api/auth/request-password-reset 返回 400 RESET_PASSWORD_DISABLED，server/config/auth.ts 无 sendResetPassword',
    featurePoint: '认证',
  },
  { title: '② 邮箱验证/邀请完全没有', featurePoint: '认证' },
  {
    title: '③ 无自助多设备会话管理（仅管理员“撤销全部”）',
    featurePoint: '认证',
  },
  { title: '④ SSO/OIDC 组件物化但零引用', featurePoint: '认证' },
  { title: "⑤ 无真实 auth: 'optional' 路由", featurePoint: '认证' },
  { title: '⑥ 无登录态改密码 UI', featurePoint: '认证' },
  { title: '⑦ install 向导被预填 secret 绕过', featurePoint: '认证' },
  {
    title:
      '① 模板自有 API（articles/numeric/external-crm/analytics）只有 auth.required()，无 authz.middleware() 示例',
    featurePoint: '授权',
  },
  {
    title:
      '② 普通注册用户无可用角色（member 权限集 grants 为空），除 root 外多数页面 403',
    featurePoint: '授权',
  },
  { title: '③ “改授权→另一会话立即生效”只有组件测试', featurePoint: '授权' },
  { title: '④ 安全事件只写文件，无审计查询 UI', featurePoint: '授权' },
  { title: '⑤ 无模板自带未授权 e2e', featurePoint: '授权' },
  {
    title: "① 仅 local 盘，s3 是 bucket: '' 空占位，无 OSS/COS 驱动",
    featurePoint: '文件',
  },
  { title: '② 无附件/存储管理设置页（v3 明确移除）', featurePoint: '文件' },
  { title: '③ 无服务端缩略图', featurePoint: '文件' },
  { title: '④ 旧版 DOC/XLS/PPT 与 ODF 仅下载', featurePoint: '文件' },
  {
    title:
      '⑤ Examples 无 nocobase-file-component-ui 预置扩展（在 Default 且未被引用）',
    featurePoint: '文件',
  },
  { title: '⑥ 文件 API 无鉴权示例（README 自述公开）', featurePoint: '文件' },
  {
    title:
      '① 无生产态聊天入口——三个模板都未物化 nocobase-ai Registry（client/extensions/ 只有 auth-ui），没有页面内聊天/悬浮球/员工任务放置的成品示例',
    featurePoint: 'AI 员工',
  },
  {
    title: '② ai/ 仅 .gitkeep，无示例员工/技能/MCP，ai/mcp/ 为空',
    featurePoint: 'AI 员工',
  },
  { title: '③ 首页/README 无 AI 条目', featurePoint: 'AI 员工' },
  {
    title: '④ e2e 默认 skip 且默认员工写 viz，与源码内置 atlas 不符',
    featurePoint: 'AI 员工',
  },
  {
    title:
      '⑤ 发布 files 未包含 ai/ 与 tsconfig.ai.json（且该 tsconfig 全仓库无引用），发布模板可能丢 AI 骨架',
    featurePoint: 'AI 员工',
  },
  {
    title: '⑥ 五种员工放置形态只有文档/dev 组件，无成品页',
    featurePoint: 'AI 员工',
  },
  { title: '① 无 SMTP/Resend 配置（仅注释）', featurePoint: '邮件' },
  {
    title: '② Examples 代码无任何 notification.send() 调用',
    featurePoint: '邮件',
  },
  {
    title: '③ 无邮件模板/HTML/附件，resolveUserEmail 未接',
    featurePoint: '邮件',
  },
  {
    title: '④ 注册验证无配置、找回密码未接线（实测 400）',
    featurePoint: '邮件',
  },
  { title: '⑤ 工作流无邮件节点', featurePoint: '邮件' },
  { title: '⑥ 无真实 SMTP 集成测试', featurePoint: '邮件' },
  {
    title: '① server/locales 为空对象，服务端翻译零演示',
    featurePoint: '多语言',
  },
  {
    title: '② 两端语言一致，服务端回退与 toast 只能靠单测',
    featurePoint: '多语言',
  },
  {
    title: '③ 应用自有复数、缺翻译 fallback、RTL/多区域无演示',
    featurePoint: '多语言',
  },
  { title: '④ 默认语言需改配置才可见', featurePoint: '多语言' },
  {
    title:
      '① 运行日志查看器 Examples/Default 都没有，只有 Hub（app-plugin-hub/client/pages/hub/log-viewer.tsx）',
    featurePoint: '日志',
  },
  { title: '② 无 DEBUG 调级演示', featurePoint: '日志' },
  { title: '③ 轮转/上限/脱敏只有库单测', featurePoint: '日志' },
  { title: '④ README 未说明 storage/logs', featurePoint: '日志' },
  {
    title: '⑤ 运行日志不落库（设计如此），易与通知/工作流日志混淆',
    featurePoint: '日志',
  },
];

const seed: SeedDefinition = defineSeed({
  name: '202609210002_seed_test_progress_data',

  async run({ query }) {
    const existing = await query
      .selectFrom('featurePoints')
      .select(['id', 'name'])
      .execute();
    const idByName = new Map<string, number>(
      existing.map((row) => [String(row.name), Number(row.id)]),
    );

    const now = new Date();
    const insert = async (
      feature: FeaturePointSeed,
      parentId: number | null,
    ): Promise<void> => {
      await query
        .insertInto('featurePoints')
        .values({
          name: feature.name,
          level: feature.level,
          parentId,
          owner: feature.owner ?? null,
          skillsStatus: feature.skillsStatus ?? 'unspecified',
          docsStatus: feature.docsStatus ?? 'unspecified',
          exampleExists: feature.exampleExists ?? 'unspecified',
          exampleFeatureStatus: feature.exampleFeatureStatus ?? 'unspecified',
          exampleExpected: feature.exampleExpected ?? null,
          exampleCurrent: feature.exampleCurrent ?? null,
          status: feature.status ?? 'unspecified',
          designScore: feature.designScore ?? null,
          designNote: feature.designNote ?? null,
          developmentScore: feature.developmentScore ?? null,
          developmentNote: feature.developmentNote ?? null,
          agentFriendlinessScore: feature.agentFriendlinessScore ?? null,
          agentFriendlinessNote: feature.agentFriendlinessNote ?? null,
          outputQualityScore: feature.outputQualityScore ?? null,
          outputQualityNote: feature.outputQualityNote ?? null,
          remark: feature.remark ?? null,
          sortOrder: featurePoints.indexOf(feature),
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      const inserted = await query
        .selectFrom('featurePoints')
        .select(['id'])
        .where('name', '=', feature.name)
        .executeTakeFirstOrThrow();
      idByName.set(feature.name, Number(inserted.id));
    };

    for (const feature of featurePoints.filter(
      (item) => item.level === 'dimension',
    )) {
      if (idByName.has(feature.name)) continue;
      await insert(feature, null);
    }

    for (const feature of featurePoints.filter(
      (item) => item.level === 'feature',
    )) {
      if (idByName.has(feature.name)) continue;
      const parentId = idByName.get(feature.dimension);
      if (parentId === undefined) {
        throw new Error(
          `Seed feature point ${feature.name} has no dimension ${feature.dimension}.`,
        );
      }
      await insert(feature, parentId);
    }

    const existingItems = await query
      .selectFrom('missingItems')
      .select(['title', 'featurePointId'])
      .execute();
    const knownItems = new Set(
      existingItems.map(
        (row) => `${String(row.featurePointId)}:${String(row.title)}`,
      ),
    );

    for (const item of missingItemSeeds) {
      const featurePointId = idByName.get(item.featurePoint);
      if (featurePointId === undefined) {
        throw new Error(
          `Missing item has no feature point ${item.featurePoint}.`,
        );
      }
      if (knownItems.has(`${featurePointId}:${item.title}`)) continue;
      await query
        .insertInto('missingItems')
        .values({
          title: item.title,
          featurePointId,
          status: 'open',
          owner: null,
          note: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }
  },
});

export default seed;
