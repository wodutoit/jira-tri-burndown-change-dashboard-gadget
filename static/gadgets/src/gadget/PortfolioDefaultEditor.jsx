import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@forge/bridge';
import { editStyles as S } from './sprintConfigShared';
import { buildPortfolioRows } from './portfolioModel';
import AllocationEditor, { initialAllocationValues, parseAllocationValues, allocationPayload } from './PortfolioAllocationEditor';

// Order-independent comparison of two { optionId: pct } maps, for "has anything changed".
const sameAlloc = (a, b) => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && Number(a[k]) === Number(b[k]));
};

function DefaultForm({ projectKey, def, options, optionsLoaded, optionsError, thresholds, onSaved, onConflict }) {
  const model = buildPortfolioRows({ options, optionsLoaded, allocation: def, thresholds, actuals: null });
  const [values, setValues] = useState(() => initialAllocationValues(model.rows));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const parsedState = parseAllocationValues(model.rows, values);
  const payload = allocationPayload(model.rows, parsedState.parsed);
  const dirty = !sameAlloc(payload.alloc, def?.alloc ?? {});
  const canSave = parsedState.allValid && !parsedState.over && dirty && !saving;

  // Sent as-is for both save and remove; an empty allocation removes the default.
  const submit = async (body) => {
    setSaving(true);
    setError(null);
    try {
      const res = await invoke('setPortfolioDefault', { projectKey, ...body, expectedUpdatedAt: def?.updatedAt ?? null });
      if (res.conflict) { onConflict(); setError(res.error); return; }
      if (res.error) { setError(res.error); return; }
      setConfirmRemove(false);
      onSaved(res.default ?? null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {model.newCount > 0 && (
        <div style={{ ...S.notice, marginTop: 10 }}>
          {model.newCount} option{model.newCount === 1 ? ' was' : 's were'} added in Jira since the default was last
          saved. {model.newCount === 1 ? 'It is' : 'They are'} at 0% until you allocate {model.newCount === 1 ? 'it' : 'them'}.
        </div>
      )}
      {model.removedCount > 0 && (
        <div style={{ ...S.notice, marginTop: 10 }}>
          {model.removedCount} categor{model.removedCount === 1 ? 'y is' : 'ies are'} no longer an option in Jira but still
          {model.removedCount === 1 ? ' has' : ' have'} a default allocation. Clear {model.removedCount === 1 ? 'it' : 'them'} when no longer needed.
        </div>
      )}
      {optionsError && (
        <div style={{ ...S.notice, marginTop: 10 }}>
          Couldn't list the field's current options ({optionsError}). Showing categories already saved.
        </div>
      )}

      <AllocationEditor
        model={model}
        values={values}
        onChange={(id, v) => setValues(cur => ({ ...cur, [id]: v }))}
        parsedState={parsedState}
        showActual={false}
      />

      {error && <div style={{ ...S.error, marginTop: 10 }}>{error}</div>}

      {confirmRemove && (
        <div style={{ ...S.notice, marginTop: 10 }}>
          Remove the default distribution? Releases without their own allocation will have no targets until you set a new one.
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={S.smallBtn} disabled={saving} onClick={() => submit({ alloc: {}, names: {} })}>Remove default</button>
            <button style={S.smallBtn} disabled={saving} onClick={() => setConfirmRemove(false)}>Keep it</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <button
          onClick={() => submit(payload)}
          disabled={!canSave}
          style={{ ...S.btn, alignSelf: 'auto', opacity: canSave ? 1 : 0.5 }}
        >
          {saving ? 'Saving…' : 'Save default'}
        </button>
        {def && !confirmRemove && (
          <button style={S.smallBtn} disabled={saving} onClick={() => setConfirmRemove(true)}>Remove default</button>
        )}
        {def && !dirty && !saving && <span style={S.hint}>Saved.</span>}
      </div>
    </>
  );
}

// Space-level default distribution: the allocation every release uses unless it
// has been given its own on the Capacity tab. Saved explicitly (not on blur)
// because the total has to be valid as a whole.
export default function PortfolioDefaultEditor({ projectKey, fieldId, options, optionsLoaded, optionsError, thresholds }) {
  const [state, setState] = useState({ loading: true, def: null, error: null });

  const load = useCallback(async () => {
    const res = await invoke('getPortfolioAllocations', { projectKey });
    setState({ loading: false, def: res.default ?? null, error: res.error ?? null });
  }, [projectKey]);

  useEffect(() => {
    setState({ loading: true, def: null, error: null });
    load().catch(e => setState({ loading: false, def: null, error: String(e) }));
  }, [load, fieldId]);

  if (state.loading) return <div style={S.hint}>Loading default distribution…</div>;
  if (state.error) return <div style={{ ...S.hint, color: 'var(--over-text)' }}>{state.error}</div>;

  return (
    <DefaultForm
      // Remount on a different field or a new stored version so the inputs
      // always start from what's actually saved.
      key={`${fieldId}:${state.def?.updatedAt ?? 'none'}`}
      projectKey={projectKey}
      def={state.def}
      options={options}
      optionsLoaded={optionsLoaded}
      optionsError={optionsError}
      thresholds={thresholds}
      onSaved={def => setState({ loading: false, def, error: null })}
      onConflict={() => load().catch(() => {})}
    />
  );
}
