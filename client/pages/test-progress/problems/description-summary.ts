/**
 * The plain text a problems-list row shows for a Markdown description.
 *
 * A row is a summary, not the document: an image, a table or a code block would
 * each take over the row, and cutting Markdown at a paragraph break can leave a
 * fence open. So blocks that are not prose are left out, inline syntax is
 * unwrapped to its text, and headings are kept only when nothing else is there.
 * The detail page still renders the full Markdown.
 */
export function descriptionSummary(markdown: string): string {
  const prose: string[] = [];
  const headings: string[] = [];
  let fence: string | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      if (
        marker !== undefined &&
        marker[0] === fence[0] &&
        marker.length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      continue;
    }
    // Table rows and rules carry no sentence of their own.
    if (/^\s*\|/.test(line) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      continue;
    }

    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    const text = unwrapInline(
      (heading?.[1] ?? line)
        .replace(/^\s*(>\s*)+/, '')
        .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ''),
    );
    if (text !== '') {
      (heading ? headings : prose).push(text);
    }
  }

  return (prose.length > 0 ? prose : headings).join(' ');
}

function unwrapInline(text: string): string {
  // A backslash escape stands for the character itself, so it is set aside
  // before emphasis and links are unwrapped and put back as plain text after.
  const escaped: string[] = [];
  return text
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, (_match, character: string) => {
      escaped.push(character);
      return `\uE000${escaped.length - 1}\uE001`;
    })
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/\*([^*\s][^*]*?)\*/g, '$1')
    .replace(
      /\uE000(\d+)\uE001/g,
      (_match, index: string) => escaped[Number(index)],
    )
    .replace(/\s+/g, ' ')
    .trim();
}
