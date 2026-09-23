import { useService } from '@nocobase/app-client';
import { clientFileRepositoryManagerToken } from '@nocobase/app-plugin-file/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Bold,
  Code,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  Loader2,
  Table as TableIcon,
} from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * Rendered Markdown for problem descriptions and comments: GFM tables, images,
 * code and links. The styling is inline because this application does not ship
 * the typography plugin, and the tokens keep it readable in both themes.
 */
const MARKDOWN_CLASS = cn(
  'text-sm leading-6 text-foreground',
  '[&_h1]:mt-3 [&_h1]:mb-2 [&_h1]:font-heading [&_h1]:text-lg [&_h1]:font-semibold',
  '[&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold',
  '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold',
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4',
  '[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md [&_img]:border [&_img]:border-border',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_hr]:my-3 [&_hr]:border-border',
  '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs',
  '[&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
);

export function MarkdownContent({
  content,
  className,
}: {
  readonly content: string;
  readonly className?: string;
}): ReactElement {
  return (
    <div className={cn(MARKDOWN_CLASS, className)}>
      <ReactMarkdown
        components={{
          a: ({ children, ...props }) => (
            <a {...props} rel='noreferrer' target='_blank'>
              {children}
            </a>
          ),
        }}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

interface ToolbarAction {
  readonly icon: ReactElement;
  readonly label: string;
  readonly apply: (selected: string) => { text: string; cursor?: number };
}

/**
 * A Markdown editor: a plain textarea with formatting buttons and a live preview.
 * The stored value is Markdown, so what a comment holds is what MarkdownContent
 * renders later without a second conversion.
 */
export function MarkdownEditor({
  id,
  value,
  onChange,
  placeholder,
  rows = 6,
}: {
  readonly id?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly rows?: number;
}): ReactElement {
  const { t } = useTranslation();
  const files = useService(clientFileRepositoryManagerToken);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);

  const actions: readonly ToolbarAction[] = [
    {
      icon: <Bold aria-hidden='true' className='size-3.5' />,
      label: t('testProgress.markdownBold'),
      apply: (selected) => ({ text: `**${selected || 'text'}**` }),
    },
    {
      icon: <Italic aria-hidden='true' className='size-3.5' />,
      label: t('testProgress.markdownItalic'),
      apply: (selected) => ({ text: `*${selected || 'text'}*` }),
    },
    {
      icon: <LinkIcon aria-hidden='true' className='size-3.5' />,
      label: t('testProgress.markdownLink'),
      apply: (selected) => ({ text: `[${selected || 'text'}](url)` }),
    },
    {
      icon: <ImageIcon aria-hidden='true' className='size-3.5' />,
      label: t('testProgress.markdownImage'),
      apply: (selected) => ({ text: `![${selected || 'alt'}](url)` }),
    },
    {
      icon: <Code aria-hidden='true' className='size-3.5' />,
      label: t('testProgress.markdownCode'),
      apply: (selected) => ({
        text: selected.includes('\n')
          ? `\`\`\`\n${selected || 'code'}\n\`\`\``
          : `\`${selected || 'code'}\``,
      }),
    },
    {
      icon: <List aria-hidden='true' className='size-3.5' />,
      label: t('testProgress.markdownList'),
      apply: (selected) => ({
        text: selected
          .split('\n')
          .map((line) => `- ${line}`)
          .join('\n') || '- ',
      }),
    },
    {
      icon: <TableIcon aria-hidden='true' className='size-3.5' />,
      label: t('testProgress.markdownTable'),
      apply: () => ({
        text: '\n| A | B |\n| --- | --- |\n|  |  |\n',
      }),
    },
  ];

  /** Inserts text at the caret and leaves it after the inserted text. */
  function insertText(text: string): void {
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange(`${value}${text}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + text.length;
      textarea.setSelectionRange(caret, caret);
    });
  }

  function applyAction(action: ToolbarAction): void {
    const textarea = textareaRef.current;
    const selected =
      textarea === null
        ? ''
        : value.slice(textarea.selectionStart, textarea.selectionEnd);
    insertText(action.apply(selected).text);
  }

  /**
   * Uploads pasted or dropped image files and inserts them as Markdown images, so
   * a screenshot ends up as a real image in the rendered description or comment.
   */
  async function uploadImages(images: readonly File[]): Promise<void> {
    setUploading(true);
    try {
      const repository = files.repository('problemImages');
      for (const image of images) {
        const { record } = await repository.uploadOne({ file: image });
        insertText(`![${record.filename}](${record.contentUrl ?? ''})`);
      }
    } catch (error) {
      toast.error(
        t('testProgress.markdownUploadFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setUploading(false);
    }
  }

  function imageFilesFrom(list: FileList | undefined | null): File[] {
    return Array.from(list ?? []).filter((file) =>
      file.type.startsWith('image/'),
    );
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>): void {
    const images = imageFilesFrom(event.clipboardData?.files);
    if (images.length === 0) return;
    event.preventDefault();
    void uploadImages(images);
  }

  function handleDrop(event: React.DragEvent<HTMLTextAreaElement>): void {
    const images = imageFilesFrom(event.dataTransfer?.files);
    if (images.length === 0) return;
    event.preventDefault();
    void uploadImages(images);
  }

  return (
    <div className='rounded-lg border border-border'>
      <div className='flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5'>
        {actions.map((action) => (
          <Button
            aria-label={action.label}
            key={action.label}
            size='icon-sm'
            title={action.label}
            type='button'
            variant='ghost'
            onClick={() => applyAction(action)}
          >
            {action.icon}
          </Button>
        ))}
        {uploading ? (
          <span className='inline-flex items-center gap-1 px-1 text-xs text-muted-foreground'>
            <Loader2 aria-hidden='true' className='size-3.5 animate-spin' />
            {t('testProgress.markdownUploading')}
          </span>
        ) : null}
        <span className='ml-auto flex items-center gap-1'>
          <Button
            size='sm'
            type='button'
            variant={preview ? 'ghost' : 'secondary'}
            onClick={() => setPreview(false)}
          >
            {t('testProgress.markdownEdit')}
          </Button>
          <Button
            size='sm'
            type='button'
            variant={preview ? 'secondary' : 'ghost'}
            onClick={() => setPreview(true)}
          >
            {t('testProgress.markdownPreview')}
          </Button>
        </span>
      </div>

      {preview ? (
        <div className='min-h-24 p-3'>
          {value.trim() === '' ? (
            <p className='text-sm text-muted-foreground'>
              {t('testProgress.markdownEmpty')}
            </p>
          ) : (
            <MarkdownContent content={value} />
          )}
        </div>
      ) : (
        <Textarea
          className='rounded-t-none border-0 shadow-none focus-visible:ring-0'
          id={id}
          placeholder={placeholder}
          ref={textareaRef}
          rows={rows}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onDrop={handleDrop}
          onPaste={handlePaste}
        />
      )}
    </div>
  );
}
