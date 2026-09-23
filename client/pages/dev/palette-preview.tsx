import { useTranslation } from '@nocobase/i18n/client';
import type { CSSProperties, ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import type { CriteriaState, FeatureStatus } from '../test-progress/api.js';
import { CRITERIA_CELL_CLASS } from '../test-progress/constants.js';

interface PaletteSpec {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly light: ColorSpec;
  readonly dark: ColorSpec;
}

interface ColorSpec {
  readonly success: string;
  readonly warning: string;
  readonly info: string;
  readonly destructive: string;
}

const PALETTES: readonly PaletteSpec[] = [
  {
    id: 'vivid',
    title: 'A · 明快三色（青绿 / 靛蓝 / 橙）',
    description: '绿=完成、蓝=里程碑、橙=进行中，色相区分度最高，仪表盘感强。',
    light: {
      success: 'oklch(0.63 0.14 162)',
      warning: 'oklch(0.73 0.16 62)',
      info: 'oklch(0.58 0.16 258)',
      destructive: 'oklch(0.60 0.19 25)',
    },
    dark: {
      success: 'oklch(0.76 0.15 162)',
      warning: 'oklch(0.80 0.15 70)',
      info: 'oklch(0.74 0.13 258)',
      destructive: 'oklch(0.72 0.16 25)',
    },
  },
  {
    id: 'soft',
    title: 'B · 柔和低饱和（鼠尾草 / 灰蓝 / 沙金）',
    description: '低饱和、克制，整页色块安静；缺点是远看对比弱一些。',
    light: {
      success: 'oklch(0.66 0.09 165)',
      warning: 'oklch(0.77 0.10 78)',
      info: 'oklch(0.62 0.09 250)',
      destructive: 'oklch(0.65 0.12 25)',
    },
    dark: {
      success: 'oklch(0.78 0.09 165)',
      warning: 'oklch(0.84 0.10 80)',
      info: 'oklch(0.76 0.09 250)',
      destructive: 'oklch(0.76 0.11 25)',
    },
  },
  {
    id: 'classic',
    title: 'C · 经典状态色（绿 / 蓝 / 黄）',
    description: '最接近常见项目管理工具；黄色比现在更亮，不会发土。',
    light: {
      success: 'oklch(0.62 0.15 148)',
      warning: 'oklch(0.78 0.15 85)',
      info: 'oklch(0.60 0.13 235)',
      destructive: 'oklch(0.58 0.20 27)',
    },
    dark: {
      success: 'oklch(0.76 0.16 150)',
      warning: 'oklch(0.84 0.15 85)',
      info: 'oklch(0.74 0.12 235)',
      destructive: 'oklch(0.71 0.18 25)',
    },
  },
];

function panelVars(spec: ColorSpec, mode: 'light' | 'dark'): CSSProperties {
  const surface = mode === 'light' ? '#ffffff' : '#171717';
  const onColor = mode === 'light' ? '#ffffff' : '#141414';
  const onWarning = mode === 'light' ? '#2a1c00' : '#141414';
  const muted = (color: string): string =>
    // oklab, not oklch: white has no hue, and oklch interpolation drags every
    // hue toward it — all four states would render the same pink wash.
    `color-mix(in oklab, ${color} ${mode === 'light' ? 10 : 18}%, ${surface})`;

  return {
    '--success': spec.success,
    '--success-foreground': onColor,
    '--success-muted': muted(spec.success),
    '--warning': spec.warning,
    '--warning-foreground': onWarning,
    '--warning-muted': muted(spec.warning),
    '--info': spec.info,
    '--info-foreground': onColor,
    '--info-muted': muted(spec.info),
    '--destructive': spec.destructive,
    '--destructive-muted': muted(spec.destructive),
  } as CSSProperties;
}

const CRITERIA_TEXT: Record<CriteriaState, string> = {
  complete: 'text-success',
  hasGaps: 'text-warning',
  missing: 'text-destructive',
  unspecified: 'text-neutral-400 dark:text-neutral-500',
};

const CRITERIA_DOT: Record<CriteriaState, string> = {
  complete: 'bg-success',
  hasGaps: 'bg-warning',
  missing: 'bg-destructive',
  unspecified: 'bg-neutral-300 dark:bg-neutral-600',
};

const STATUS_CELL: Record<FeatureStatus, string> = {
  testable: 'bg-info-muted',
  developed: 'bg-info-muted',
  testCompleted: 'bg-success-muted',
  refactoring: 'bg-warning-muted',
  inProgress: 'bg-warning-muted',
  deferred: 'bg-destructive/5',
  unspecified: '',
};

const STATUS_DOT: Record<FeatureStatus, string> = {
  testable: 'bg-info',
  developed: 'bg-info',
  testCompleted: 'bg-success',
  refactoring: 'bg-warning',
  inProgress: 'bg-warning',
  deferred: 'bg-destructive',
  unspecified: 'bg-muted-foreground/40',
};

const STATUS_TEXT: Record<FeatureStatus, string> = {
  testable: 'text-info',
  developed: 'text-info',
  testCompleted: 'text-success',
  refactoring: 'text-warning',
  inProgress: 'text-warning',
  deferred: 'text-destructive',
  unspecified: 'text-muted-foreground',
};

interface SampleRow {
  readonly name: string;
  readonly skills: CriteriaState;
  readonly docs: CriteriaState;
  readonly example: CriteriaState;
  readonly status: FeatureStatus;
}

const SAMPLE_ROWS: readonly SampleRow[] = [
  {
    name: '数据库',
    skills: 'complete',
    docs: 'hasGaps',
    example: 'missing',
    status: 'testCompleted',
  },
  {
    name: '认证',
    skills: 'hasGaps',
    docs: 'unspecified',
    example: 'complete',
    status: 'developed',
  },
  {
    name: '邮件',
    skills: 'missing',
    docs: 'complete',
    example: 'unspecified',
    status: 'inProgress',
  },
];

export default function PalettePreviewPage(): ReactElement {
  const { t } = useTranslation();

  return (
    <PageContainer>
      <PageHeader
        title={t('dev.palettePreview', { defaultValue: '配色预览' })}
        description={t('dev.palettePreviewDescription', {
          defaultValue:
            '开发专用：三套候选状态配色 × 浅色/深色 × 两种标签样式。选定后应用到主题 token。',
        })}
      />
      {PALETTES.map((palette) => (
        <Card key={palette.id}>
          <CardHeader>
            <CardTitle>{palette.title}</CardTitle>
            <p className='text-sm text-muted-foreground'>
              {palette.description}
            </p>
          </CardHeader>
          <CardContent className='grid gap-4 lg:grid-cols-2'>
            <Panel mode='light' palette={palette} />
            <Panel mode='dark' palette={palette} />
          </CardContent>
        </Card>
      ))}
    </PageContainer>
  );
}

function Panel({
  palette,
  mode,
}: {
  readonly palette: PaletteSpec;
  readonly mode: 'light' | 'dark';
}): ReactElement {
  const { t } = useTranslation();
  const spec = mode === 'light' ? palette.light : palette.dark;

  return (
    <div
      className={cn(
        'space-y-3 rounded-xl p-4',
        mode === 'light'
          ? 'bg-white text-neutral-900'
          : 'bg-neutral-950 text-neutral-100',
      )}
      style={panelVars(spec, mode)}
    >
      <p className='text-xs font-medium opacity-60'>
        {mode === 'light' ? '浅色' : '深色'} ·{' '}
        {t('dev.paletteVariantTint', {
          defaultValue: '方案 1：整格浅底 + 无底色标签（推荐）',
        })}
      </p>

      <table className='w-full border-separate border-spacing-0 text-sm'>
        <tbody>
          {SAMPLE_ROWS.map((row) => (
            <tr key={row.name}>
              <td className='border-b border-current/10 p-2 font-medium'>
                {row.name}
              </td>
              <td
                className={cn(
                  'border-b border-current/10 p-2',
                  CRITERIA_CELL_CLASS[row.skills],
                )}
              >
                <DotLabel
                  dotClass={CRITERIA_DOT[row.skills]}
                  textClass={CRITERIA_TEXT[row.skills]}
                  label={criteriaLabel(row.skills)}
                />
              </td>
              <td
                className={cn(
                  'border-b border-current/10 p-2',
                  CRITERIA_CELL_CLASS[row.docs],
                )}
              >
                <DotLabel
                  dotClass={CRITERIA_DOT[row.docs]}
                  textClass={CRITERIA_TEXT[row.docs]}
                  label={criteriaLabel(row.docs)}
                />
              </td>
              <td
                className={cn(
                  'border-b border-current/10 p-2',
                  CRITERIA_CELL_CLASS[row.example],
                )}
              >
                <DotLabel
                  dotClass={CRITERIA_DOT[row.example]}
                  textClass={CRITERIA_TEXT[row.example]}
                  label={criteriaLabel(row.example)}
                />
              </td>
              <td
                className={cn(
                  'border-b border-current/10 p-2',
                  STATUS_CELL[row.status],
                )}
              >
                <DotLabel
                  dotClass={STATUS_DOT[row.status]}
                  textClass={STATUS_TEXT[row.status]}
                  label={statusLabel(row.status)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className='text-xs font-medium opacity-60'>
        {t('dev.paletteVariantSolid', {
          defaultValue: '方案 2：无底色 + 实心标签（对比用）',
        })}
      </p>
      <div className='flex flex-wrap gap-2'>
        {(
          [
            ['complete', '完整'],
            ['hasGaps', '缺失 N'],
            ['missing', '没有'],
            ['unspecified', '未填写'],
          ] as const
        ).map(([value, label]) => (
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
              value === 'complete' && 'bg-success text-success-foreground',
              value === 'hasGaps' && 'bg-warning text-warning-foreground',
              value === 'missing' && 'bg-destructive/15 text-destructive',
              value === 'unspecified' &&
                'border-dashed border-neutral-300 text-neutral-400 dark:border-neutral-600 dark:text-neutral-500',
            )}
            key={value}
          >
            {label}
          </span>
        ))}
      </div>
      <div className='flex flex-wrap gap-2'>
        {(
          [
            ['testable', '可以测试'],
            ['developed', '开发完成'],
            ['testCompleted', '测试完成BUG修复'],
            ['inProgress', '进行中'],
            ['refactoring', '重构中'],
            ['deferred', '延期'],
          ] as const
        ).map(([value, label]) => (
          <DotLabel
            dotClass={STATUS_DOT[value]}
            key={value}
            label={label}
            textClass={STATUS_TEXT[value]}
          />
        ))}
      </div>
    </div>
  );
}

function DotLabel({
  dotClass,
  textClass,
  label,
}: {
  readonly dotClass: string;
  readonly textClass: string;
  readonly label: string;
}): ReactElement {
  return (
    <span className='inline-flex items-center gap-1.5 text-xs font-medium'>
      <span className={cn('size-1.5 rounded-full', dotClass)} />
      <span className={textClass}>{label}</span>
    </span>
  );
}

function criteriaLabel(value: CriteriaState): string {
  return {
    complete: '完整',
    hasGaps: '缺失 N',
    missing: '没有',
    unspecified: '未填写',
  }[value];
}

function statusLabel(value: FeatureStatus): string {
  return {
    testable: '可以测试',
    developed: '开发完成',
    testCompleted: '测试完成BUG修复',
    refactoring: '重构中',
    inProgress: '进行中',
    deferred: '延期',
    unspecified: '未填写',
  }[value];
}
