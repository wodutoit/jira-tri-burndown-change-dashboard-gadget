export const DEFAULT_PHASE_MAP = {
  'To Do':          'backlog',
  'BA Reviewed':    'backlog',
  'Team Estimated': 'backlog',
  'Open':           'backlog',
  'In Progress':    'dev',
  'Blocked':        'blocked',
  'Code Review':    'review',
  'Testing':        'test',
  'Test Design':    'test',
  'Done':           'done',
  'Closed':         'done',
  'Not Required':   'excluded',
};

export const PHASE_OPTIONS = [
  { value: 'backlog',  label: 'To Do' },
  { value: 'dev',      label: 'In Progress' },
  { value: 'blocked',  label: 'Blocked' },
  { value: 'review',   label: 'Review (Code Review)' },
  { value: 'test',     label: 'Test' },
  { value: 'done',     label: 'Done' },
  { value: 'excluded', label: 'Excluded (Not Required)' },
];

export const editStyles = {
  wrap: { padding: 16, display: 'flex', flexDirection: 'column', gap: 16, fontFamily: 'inherit', color: 'var(--text)', fontSize: 13 },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontWeight: 600, fontSize: 12, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  select: { width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '7px 10px', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', fontFamily: 'inherit' },
  hint: { fontSize: 11, color: 'var(--text-subtlest)', marginTop: 2 },
  statusRow: { display: 'flex', alignItems: 'center', gap: 8 },
  statusName: { flex: '0 0 140px', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  phaseSelect: { flex: 1, border: '1px solid var(--border)', borderRadius: 3, padding: '4px 6px', fontSize: 12, color: 'var(--text)', background: 'var(--surface)', fontFamily: 'inherit' },
  btn: { alignSelf: 'flex-start', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  divider: { borderTop: '1px solid var(--border)', margin: '4px 0' },
  error: { fontSize: 12, color: 'var(--over-text)', padding: '6px 10px', background: 'var(--surface-sunken)', borderRadius: 4 },
  radioRow: { display: 'flex', gap: 16, alignItems: 'center' },
  radioLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' },
};

export function Section({ title, children, disabled }) {
  return (
    <div style={{ ...editStyles.section, opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <div style={editStyles.label}>{title}</div>
      {children}
    </div>
  );
}

export const DISPLAY_MODE_OPTIONS = [
  { value: 'chart',      label: 'Chart' },
  { value: 'table',      label: 'Table' },
  { value: 'both-2col',  label: 'Both — side by side' },
  { value: 'both-1col',  label: 'Both — stacked' },
];

// Shared "Display As" section used by every gadget with a chart-or-table
// config choice. `hint` describes what the chart/table actually show for
// that specific widget.
export function DisplayModeSection({ title, displayMode, setDisplayMode, hint }) {
  return (
    <Section title={title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {DISPLAY_MODE_OPTIONS.map(o => (
          <label key={o.value} style={editStyles.radioLabel}>
            <input type="radio" name="displayMode" value={o.value} checked={displayMode === o.value}
                   onChange={() => setDisplayMode(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
      <div style={editStyles.hint}>
        {hint} "Side by side" shows chart and table in two columns that stack into one on narrow screens. When showing just one of Chart or Table, a toggle next to the Refresh button lets you switch between them while viewing.
      </div>
    </Section>
  );
}
