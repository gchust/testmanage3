import type { ReactElement, ReactNode } from 'react';

export interface AuthBrandProps {
  readonly light?: ReactNode;
  readonly dark?: ReactNode;
  readonly name?: ReactNode;
}

/**
 * Application-owned copy of the authentication brand. The application is named
 * Test Manager, so a string name is rendered as a text wordmark instead of the
 * template's NocoBase logo images.
 */
export function AuthBrand({
  light,
  dark,
  name = 'Test Manager',
}: AuthBrandProps): ReactElement {
  const wordmark =
    typeof name === 'string' ? (
      <span className='text-2xl font-semibold tracking-[-0.03em]'>{name}</span>
    ) : (
      name
    );

  return (
    <div
      aria-label={typeof name === 'string' ? name : undefined}
      className='flex min-h-10 w-full items-center justify-start'
      role='img'
    >
      <span className='dark:hidden'>{light ?? wordmark}</span>
      <span className='hidden dark:block'>{dark ?? light ?? wordmark}</span>
    </div>
  );
}
