import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

export interface AppBrandProps {
  readonly compact?: boolean;
}

/**
 * The application ships as Test Manager, so the brand is rendered as text rather
 * than the template's NocoBase wordmark images. Keep this aligned with
 * `client/locales/*` and `config.yml` (`client.app.title`) if the name changes.
 */
export function AppBrand(inputProps: AppBrandProps): ReactElement {
  const { t } = useTranslation();
  const { compact = false } = inputProps;
  const title = t('app.title', { defaultValue: 'Test Manager' });

  return (
    <Link
      aria-label={t('navigation.brandHome', {
        defaultValue: 'Test Manager home',
      })}
      className='flex min-w-0 items-center text-foreground'
      to='/'
    >
      {compact ? (
        <span className='grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-xs font-semibold tracking-tight text-primary-foreground'>
          TM
        </span>
      ) : (
        <span className='truncate text-lg font-semibold tracking-[-0.02em]'>
          {title}
        </span>
      )}
    </Link>
  );
}
