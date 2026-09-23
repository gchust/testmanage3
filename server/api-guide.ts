/**
 * The tracker's API reference, served as Markdown at `/api-guide.md` so an Agent
 * can read it with one request and the page renders exactly what the Agent reads.
 *
 * Keeping it on the server is what makes the copied prompt short: the prompt only
 * carries the connection details and this URL, and a later change to the guide
 * reaches every Agent on its next read.
 */
export interface ApiGuideInput {
  /** Public site root, e.g. `http://localhost:13000/main/`. */
  readonly site: string;
  /** Public API prefix, e.g. `http://localhost:13000/main/api`. */
  readonly api: string;
}

export function buildApiGuideMarkdown(input: ApiGuideInput): string {
  const { site, api } = input;

  return `# Test Manager 测试进展 API

- 站点：${site}
- 接口前缀：${api}
- 认证：见下方「1. 认证」，用你自己的账号
- 返回格式：成功 \`{ "data": ... }\`；失败 \`{ "code": "...", "message": "..." }\`，HTTP 状态码 400/401/404/409

## 1. 认证（Agent 必读）

请使用**你自己的账号**，不要共用别人的凭据。两种方式：

### 方式 A：账号密码换会话（Agent 常用）

\`\`\`bash
curl -s -c cookies.txt -H 'content-type: application/json' \
  -d '{"username":"<你的用户名>","password":"<你的密码>"}' \
  ${api}/auth/sign-in/username

# 之后每个请求带上会话 Cookie
curl -s -b cookies.txt ${api}/test-progress/summary

# 退出
curl -s -b cookies.txt -X POST ${api}/auth/sign-out
\`\`\`

返回 200 表示登录成功，凭据错误返回 4xx。会话 Cookie 有有效期，长任务建议用方式 B。

### 方式 B：API Key（长期或无人值守）

1. 用户在应用的「设置 → API Keys」创建；已登录的调用方也可以 \`POST ${api}/auth/api-key/create\` 创建。
2. 之后请求直接带 \`x-api-key\`，不需要 Cookie：

\`\`\`bash
curl -s -H 'x-api-key: <key>' '${api}/test-progress/problems?open=true'
\`\`\`

### 规则

- 权限与身份跟随所用账号（会话登录者，或 key 的创建者），不要借用他人 key。
- 凭据只放在环境变量或本地文件，不要写进代码、日志，也不要提交到仓库。
- 没有凭据时先向用户索取，不要猜测或尝试默认密码。

## 2. 总览

\`GET ${api}/test-progress/summary\`
返回大维度/功能点数量、状态分布、准入单元格分布、未关闭问题数、各维度进展。

## 3. 功能点（大维度与功能点）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | \`/test-progress/feature-points\` | 全部大维度与功能点（含每个功能点的问题计数） |
| GET | \`/test-progress/feature-points/:id\` | 单个功能点 |
| POST | \`/test-progress/feature-points\` | 新建（大维度 level=dimension 无 parentId；功能点必须给 parentId） |
| PATCH | \`/test-progress/feature-points/:id\` | 局部更新 |
| DELETE | \`/test-progress/feature-points/:id\` | 删除（有子功能点的大维度会返回 409） |

字段取值：

- \`skillsStatus\` / \`docsStatus\`：\`available\` 有 | \`missing\` 没有 | \`unspecified\` 未填写
- \`exampleExists\`：\`yes\` | \`no\` | \`unspecified\`
- \`status\`：\`testable\` | \`developed\` | \`testCompleted\` | \`refactoring\` | \`inProgress\` | \`deferred\` | \`unspecified\`
- 评分（0–10，可空）：\`designScore\` / \`developmentScore\` / \`agentFriendlinessScore\` / \`outputQualityScore\`，配套 \`*Note\`
- 其他：\`owner\`、\`exampleExpected\`、\`exampleCurrent\`、\`remark\`

示例：新建功能点

\`\`\`json
POST ${api}/test-progress/feature-points
{ "name": "导入导出", "level": "feature", "parentId": 28, "owner": "龚诚", "status": "inProgress" }
\`\`\`

示例：修改准入字段与评分

\`\`\`json
PATCH ${api}/test-progress/feature-points/28
{
  "skillsStatus": "available",
  "docsStatus": "missing",
  "exampleExists": "yes",
  "agentFriendlinessScore": 8,
  "agentFriendlinessNote": "主流程清楚，边界需补充"
}
\`\`\`

## 4. 问题单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | \`/test-progress/problems\` | 问题列表，支持 \`featurePointId\`、\`type\`、\`status\`、\`open=true\`（未关闭） |
| GET | \`/test-progress/problems/:id\` | 单个问题 |
| POST | \`/test-progress/problems\` | 新建问题（会写入时间线「创建」） |
| PATCH | \`/test-progress/problems/:id\` | 局部更新（改 \`status\` 会写入时间线） |
| DELETE | \`/test-progress/problems/:id\` | 删除问题（连同评论与时间线） |

- \`type\`：\`skills\` | \`docs\` | \`example\` | \`automation\` | \`manual\`
- \`status\`：\`pending\` 待确认 | \`fixing\` 修复中 | \`regression\` 待回归 | \`verified\` 已关闭 | \`cancelled\` 已取消
- \`verified\` 与 \`cancelled\` 都算已关闭：不再计入准入单元格的「缺失 N」
- 准入单元格由问题派生：该类型有 N 个未关闭问题，就显示「缺失 N」
- \`description\` 支持 Markdown（表格、图片、代码）

示例：新建一个问题

\`\`\`json
POST ${api}/test-progress/problems
{
  "title": "迁移回滚后表残留",
  "featurePointId": 28,
  "type": "automation",
  "status": "pending",
  "owner": "陈霖",
  "description": "**复现**：执行回滚后 orders 表仍在。\\\\n\\\\n| 步骤 | 结果 |\\\\n| --- | --- |\\\\n| 回滚 | 表残留 |"
}
\`\`\`

示例：修改状态

\`\`\`json
PATCH ${api}/test-progress/problems/12
{ "status": "cancelled" }
\`\`\`

## 5. 评论与时间线

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | \`/test-progress/problems/:id/comments\` | 评论列表（按时间正序） |
| POST | \`/test-progress/problems/:id/comments\` | 发表评论，作者取自当前登录身份 |
| DELETE | \`/test-progress/problem-comments/:id\` | 删除评论（只能删自己的，否则 404） |
| GET | \`/test-progress/problems/:id/activities\` | 时间线：创建与状态变更记录 |

示例：发表评论（Markdown）

\`\`\`json
POST ${api}/test-progress/problems/12/comments
{ "content": "已在本地复现\\\\n\\\\n| 环境 | 结果 |\\\\n| --- | --- |\\\\n| 开发 | 必现 |" }
\`\`\`

## 6. 图片上传

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | \`/problemImages:uploadOne\` | \`multipart/form-data\`，字段名 \`file\`，≤ 5MB |
| GET | \`/uploads/problems/<uuid>.<ext>\` | 读取图片（需要登录态） |

上传返回 \`data.record.contentUrl\`（例如 \`${site}uploads/problems/<uuid>.png\`），把它写进 Markdown 的 \`![](url)\` 即可在描述或评论里显示。

## 7. 约定

- 写入前先 GET 当前值，避免覆盖别人刚改的字段（局部更新只发要改的键）
- 状态变更会留下时间线，记录操作人
- 删除不可恢复；批量操作前先确认
- 大维度（\`level=dimension\`）自身也允许填状态、评分与问题，统计时单独聚合
`;
}
