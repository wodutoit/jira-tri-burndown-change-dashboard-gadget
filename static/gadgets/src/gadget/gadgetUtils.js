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
