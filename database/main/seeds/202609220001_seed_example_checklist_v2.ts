import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * Second pass over the Example checklist.
 *
 * The first import carried the workbook's numbering markers and only the missing
 * items. This pass drops those markers from existing titles, and adds what the
 * follow-up review marked as already demonstrated (status `fixed`) plus the one
 * new finding for 知识库. Rows a user has edited beyond the marker are left alone:
 * only a leading ①..⑳ marker is removed, and an item whose title already exists
 * is never inserted twice.
 */

/** Circled numbers ①..⑳, the markers the workbook used. */
const MARKERS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

function stripMarker(title: string): string {
  if (title === '' || !MARKERS.includes(title[0])) {
    return title;
  }

  return title.slice(1).replace(/^[\s、.．:：]+/u, '');
}

interface ChecklistSeed {
  readonly featurePoint: string;
  readonly done: readonly string[];
  readonly open: readonly string[];
}

const CHECKLIST: readonly ChecklistSeed[] = [
  {
    featurePoint: '应用搭建',
    done: [
      '组合根 client/runtime.ts、server/runtime.ts、client/routes.ts',
      '路由与覆盖层最完整（client/routes.ts:33-101、pages/route-overlays/）',
      '3 个应用自有工作流（server/workflows/）',
      '11 个 packages/examples/ 插件示例',
      'scheduler/queue/realtime/service-provider 服务端示例齐全',
    ],
    open: [],
  },
  {
    featurePoint: '数据库',
    done: [
      'database/main 迁移+种子',
      'analytics 独立连接（server/config/database.ts、database/analytics/*、server/routes/analytics.ts）',
      'externalCrm 只读 + metadata.json（database/externalCrm/collections/*）',
      'Repository 全能力（app-plugin-repository-example）',
      'Query vs Repository（/numeric-examples）',
      'Database Explorer 设置页',
      '迁移回滚测试',
    ],
    open: [],
  },
  {
    featurePoint: '认证',
    done: [
      '登录登出注册',
      '忘记/重置页',
      'auth: guest/required guard',
      '会话存库',
      'API Keys（root 可开 /settings/api-keys）',
      '初始管理员 seed（nocobase/admin123）',
    ],
    open: [],
  },
  {
    featurePoint: '授权',
    done: [
      'app-plugin-authorization-example 完整业务演示（4 页 + 字段白名单 + 行 scope + 团队共享 + 三类规则种子；账号 sales_* / AuthzExample123!）',
      '权限集、用户管理、Inspector 均已注册',
      "authz: 'skip' 与页面拒绝可演示",
    ],
    open: [],
  },
  {
    featurePoint: '文件',
    done: [
      '/file-repository 三页（附件上传、头像 1:1、订单 1:N）',
      '预览支持位图/PDF/文本/音视频 + DOCX/XLSX/PPTX 本地渲染',
      '缩略图（前端原图缩放）',
    ],
    open: [],
  },
  {
    featurePoint: 'AI 员工',
    done: [
      '插件已注册（client/server）',
      'Settings→AI 管理页（Employees/Skills/Tools/Conversations）',
      '开发态 /dev/ai-components/* 组件演示（配了 LLM 可真实对话）',
      '内置员工 Atlas',
      '环境已解决：config.yml 写入 dashscope-test（qwen3.7-flash + text-embedding-v4），启动日志 llmServices:1，真实调通 DashScope',
    ],
    open: [],
  },
  {
    featurePoint: '知识库',
    done: [],
    open: ['开源无 example；Pro 无实例，仅插件包 dev 路由'],
  },
  {
    featurePoint: '邮件',
    done: [
      '通知运行时与 Email/IM Provider 定义已注册',
      '/settings/notifications/logs 有常驻“Send test notification”和通知日志',
      'In-app 可走通“发送→收件箱→日志”',
    ],
    open: [],
  },
  {
    featurePoint: '多语言',
    done: [
      'en-US/zh-CN 双端文件',
      '语言切换器（禁用/隐藏逻辑）',
      '切换持久化+通知服务端',
      'overrides（Examples 独有增量）',
      '插值、Intl 日期数字、i18n:check',
    ],
    open: [],
  },
  {
    featurePoint: '日志',
    done: [
      'server/config/logging.ts（file+console+request）',
      '请求日志中间件',
      '工作流节点日志落库 + 运行详情页',
      '通知发送日志设置页',
      'scheduled-log-job 主动打日志',
    ],
    open: [],
  },
];

const seed: SeedDefinition = defineSeed({
  name: '202609220001_seed_example_checklist_v2',

  async run({ query }) {
    const featurePoints = await query
      .selectFrom('featurePoints')
      .select(['id', 'name'])
      .execute();
    const idByName = new Map(
      featurePoints.map((row) => [String(row.name), Number(row.id)]),
    );

    // Drop the numbering markers the first import carried.
    const rows = await query
      .selectFrom('missingItems')
      .select(['id', 'title'])
      .execute();
    const now = new Date();
    for (const row of rows) {
      const title = typeof row.title === 'string' ? row.title : '';
      const stripped = stripMarker(title);
      if (stripped === title) continue;
      await query
        .updateTable('missingItems')
        .set({ title: stripped, updatedAt: now })
        .where('id', '=', Number(row.id))
        .execute();
    }

    const current = await query
      .selectFrom('missingItems')
      .select(['featurePointId', 'title'])
      .execute();
    const known = new Set(
      current.map(
        (row) => `${String(row.featurePointId)}:${String(row.title)}`,
      ),
    );

    for (const entry of CHECKLIST) {
      const featurePointId = idByName.get(entry.featurePoint);
      if (featurePointId === undefined) {
        throw new Error(
          `Checklist references unknown feature point ${entry.featurePoint}.`,
        );
      }

      for (const [status, titles] of [
        ['fixed', entry.done],
        ['open', entry.open],
      ] as const) {
        for (const title of titles) {
          const key = `${featurePointId}:${title}`;
          if (known.has(key)) continue;
          await query
            .insertInto('missingItems')
            .values({
              title,
              featurePointId,
              status,
              owner: null,
              note: null,
              createdAt: now,
              updatedAt: now,
            })
            .execute();
          known.add(key);
        }
      }
    }
  },
});

export default seed;
