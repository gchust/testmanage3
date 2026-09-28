import { describe, expect, it } from 'vitest';

import { descriptionSummary } from '../../client/pages/test-progress/problems/description-summary.js';

describe('problem description summary', () => {
  it('keeps prose and unwraps inline Markdown to its text', () => {
    expect(
      descriptionSummary(
        '**复现**：执行 `db rollback` 后 [orders](https://example.com/o) 表仍在。\n\n- 第一步\n- ~~第二步~~',
      ),
    ).toBe('复现：执行 db rollback 后 orders 表仍在。 第一步 第二步');
  });

  it('leaves out images, tables and code blocks, including an unclosed fence', () => {
    expect(
      descriptionSummary(
        [
          '![截图](https://example.com/uploads/problems/a.png)',
          '',
          '| 步骤 | 结果 |',
          '| --- | --- |',
          '| 回滚 | 表残留 |',
          '',
          '```ts',
          'await migration.down();',
          '```',
          '',
          '回滚后表残留。',
          '',
          '```',
          'never closed',
        ].join('\n'),
      ),
    ).toBe('回滚后表残留。');
  });

  it('uses headings only when a description has nothing else', () => {
    expect(descriptionSummary('## 问题\n\n数据丢失')).toBe('数据丢失');
    expect(descriptionSummary('## 待补充')).toBe('待补充');
    expect(descriptionSummary('![](https://example.com/a.png)')).toBe('');
  });

  it('keeps identifiers with underscores and escaped characters intact', () => {
    expect(descriptionSummary('字段 feature_point_id 为 \\*必填\\*')).toBe(
      '字段 feature_point_id 为 *必填*',
    );
  });
});
