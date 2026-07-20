// Maps a Jira status category key ("new" | "indeterminate" | "done") to the
// design tokens defined in styles.css, so every gadget colors status the same
// way without repeating the mapping in each component.
const STATUS_CATEGORY_STYLE = {
  new: { bg: 'var(--lz-n-bg)', text: 'var(--lz-n-text)' },
  indeterminate: { bg: 'var(--info-bg)', text: 'var(--info-text)' },
  done: { bg: 'var(--ok-bg)', text: 'var(--ok-text)' },
};

export function statusStyle(categoryKey) {
  return STATUS_CATEGORY_STYLE[categoryKey] ?? STATUS_CATEGORY_STYLE.new;
}

// Forge resolvers run server-side in UTC, so new Date() there can lag a full
// calendar day behind for sites east of UTC (e.g. still "yesterday" in UTC
// during the morning in Sydney). The browser knows the viewer's real local
// date, so compute it here and send it to the resolver instead of trusting
// server-side "today".
export function localTodayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
