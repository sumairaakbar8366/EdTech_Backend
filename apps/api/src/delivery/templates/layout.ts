/** Escapes text for HTML email bodies. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Plain, table-free HTML email: one white card, readable in every client and in dark mode.
 * `paragraphs` are plain text (escaped here); `action` adds one button with the link also written out.
 */
export function emailLayout(opts: { heading: string; paragraphs: string[]; action?: { label: string; url: string }; code?: string; footer?: string }): string {
  const p = (t: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#1f2937">${esc(t)}</p>`;
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6f9;font-family:Inter,Segoe UI,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:28px 28px 20px;border:1px solid #e5e7eb">
<div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2f3e52;margin-bottom:18px">Skool EdTech</div>
<h1 style="margin:0 0 16px;font-size:20px;color:#111827">${esc(opts.heading)}</h1>
${opts.paragraphs.map(p).join('\n')}
${opts.code ? `<div style="margin:18px 0;font-size:30px;font-weight:700;letter-spacing:.3em;color:#111827;font-family:Consolas,monospace">${esc(opts.code)}</div>` : ''}
${opts.action ? `<p style="margin:20px 0"><a href="${esc(opts.action.url)}" style="display:inline-block;background:#c2410c;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:7px">${esc(opts.action.label)}</a></p><p style="margin:0 0 14px;font-size:13px;color:#6b7280;word-break:break-all">${esc(opts.action.url)}</p>` : ''}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0 12px">
<p style="margin:0;font-size:12px;color:#6b7280">${esc(opts.footer ?? 'This is an automatic message from Skool EdTech. Please do not reply.')}</p>
</div></body></html>`;
}
