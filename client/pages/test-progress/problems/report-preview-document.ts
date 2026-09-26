/** Keep report layout, but never execute uploaded HTML in the application origin. */
export function reportPreviewDocument(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  document
    .querySelectorAll(
      'script, iframe, object, embed, base, form, link, meta[http-equiv]',
    )
    .forEach((node) => node.remove());
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      if (
        attribute.name.toLowerCase().startsWith('on') ||
        attribute.name === 'srcdoc'
      )
        element.removeAttribute(attribute.name);
    }
  }
  const policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content =
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  document.head.prepend(policy);
  return '<!doctype html>\n' + document.documentElement.outerHTML;
}
