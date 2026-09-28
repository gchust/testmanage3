import { useTaskPermission } from './use-task-permission.js';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import { Link, Outlet } from 'react-router';
import { Plus, RefreshCw } from 'lucide-react';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Loading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyPanel, ErrorPanel } from '../test-progress/shared.js';
import { useAsyncResource } from '../test-progress/use-async-resource.js';
import { useRefetchOnReturn } from '../test-progress/use-refetch-on-return.js';
import { listTasks } from './api.js';
import { RunButton, TaskStatus } from './shared.js';

export default function BuildTasksPage() {
  const api = useApiClient(),
    { t } = useTranslation();
  const manage = useTaskPermission('manage');
  const [search, setSearch] = useState('');
  const resource = useAsyncResource('build-tasks', (signal) =>
    listTasks(api, signal),
  );
  useRefetchOnReturn(resource.reload);
  const tasks = resource.data?.tasks.filter((task) =>
    task.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('buildTasks.title')}
          description={t('buildTasks.description')}
          actions={
            <>
              <Button
                variant='outline'
                onClick={resource.reload}
                aria-label={t('buildTasks.refresh')}
              >
                <RefreshCw aria-hidden='true' />
              </Button>
              {manage.can && (
                <Button render={<Link to='new' />}>
                  <Plus aria-hidden='true' />
                  {t('buildTasks.create')}
                </Button>
              )}
            </>
          }
        />
        {resource.data &&
          !resource.data.configured &&
          resource.data.tasks.length > 0 && (
            <p
              role='status'
              className='rounded-lg border border-border bg-muted p-4 text-sm'
            >
              {t('buildTasks.notConfigured')}
            </p>
          )}
        <Input
          aria-label={t('buildTasks.search')}
          placeholder={t('buildTasks.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {resource.loading ? (
          <Loading />
        ) : resource.error ? (
          <ErrorPanel
            message={t('buildTasks.loadError')}
            onRetry={resource.reload}
          />
        ) : !tasks?.length ? (
          <EmptyPanel
            message={t(
              // The menu cannot be hidden by configuration, so say why nothing runs.
              resource.data &&
                !resource.data.configured &&
                !resource.data.tasks.length
                ? 'buildTasks.notEnabled'
                : 'buildTasks.empty',
            )}
          />
        ) : (
          <Card>
            <CardContent className='overflow-x-auto p-0'>
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      'taskTitle',
                      'statusLabel',
                      'branch',
                      'creator',
                      'updatedAt',
                      'actions',
                    ].map((key) => (
                      <TableHead key={key}>{t(`buildTasks.${key}`)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className='min-w-56 font-medium'>
                        <Link
                          className='text-primary hover:underline'
                          to={task.id}
                        >
                          {task.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <TaskStatus status={task.latestRun?.status} />
                      </TableCell>
                      <TableCell
                        className='max-w-52 truncate font-mono text-xs'
                        title={task.targetBranch}
                      >
                        {task.targetBranch}
                      </TableCell>
                      <TableCell>{task.createdByName}</TableCell>
                      <TableCell className='whitespace-nowrap'>
                        {new Date(task.updatedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <RunButton
                          taskId={task.id}
                          active={!!task.latestRun?.active}
                          configured={!!resource.data?.configured}
                          onRun={resource.reload}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </PageContainer>
      <Outlet />
    </>
  );
}
