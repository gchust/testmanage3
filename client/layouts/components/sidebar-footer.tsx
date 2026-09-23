import { Trans } from 'react-i18next';
import { useTranslation } from '@nocobase/i18n/client';
import { ShieldCheck } from 'lucide-react';
import type { ReactElement } from 'react';

export function SidebarFooter({
  collapsed,
}: {
  readonly collapsed: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const templateName =
    typeof __PORTAL_TEMPLATE_NAME__ === 'string'
      ? __PORTAL_TEMPLATE_NAME__
      : 'Default Template';
  const templateVersion =
    typeof __PORTAL_TEMPLATE_VERSION__ === 'string'
      ? __PORTAL_TEMPLATE_VERSION__
      : '0.0.0';
  const templateLabel = `${templateName} v${templateVersion}`;
  // The application is Test Manager; the template's external NocoBase link and
  // product copy were replaced, so this is plain text rather than a link.
  const brandName = (
    <span className='rounded-sm font-medium'>Test Manager</span>
  );

  return (
    <footer className='shrink-0 border-t border-sidebar-border/70'>
      <div
        className={`flex min-h-20 items-center gap-3 px-5 py-3 ${collapsed ? 'md:min-h-16 md:justify-center md:px-2' : ''}`}
        title={templateLabel}
      >
        <ShieldCheck className='size-4 shrink-0 text-sidebar-foreground/80' />
        <div
          className={`min-w-0 text-xs leading-4 ${collapsed ? 'md:hidden' : ''}`}
        >
          <div className='font-semibold text-sidebar-foreground'>
            {t('shell.buildFreely', { defaultValue: 'Test progress tracking' })}
          </div>
          <div className='text-sidebar-foreground/80'>
            <Trans
              t={t}
              i18nKey='shell.reliability'
              defaults='<brand>Test Manager</brand> tracks feature points, Example coverage and quality scores.'
              components={{
                brand: brandName,
              }}
            >
              {brandName} tracks feature points, Example coverage and quality
              scores.
            </Trans>
          </div>
          <div className='mt-1 font-mono text-xs text-sidebar-foreground/70'>
            {templateLabel}
          </div>
        </div>
      </div>
    </footer>
  );
}
