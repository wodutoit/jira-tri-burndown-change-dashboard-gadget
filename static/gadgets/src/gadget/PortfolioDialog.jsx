import React, { useState } from 'react';
import { editStyles as S } from './sprintConfigShared';
import AllocationEditor, { initialAllocationValues, parseAllocationValues, allocationPayload } from './PortfolioAllocationEditor';

// Per-release allocation editor. The parent remounts it (via `key`) whenever the
// stored allocation changes underneath it, so the inputs always start from — and
// `loadedUpdatedAt` always matches — the version actually on screen.
//
// A release shows the space default until it's given its own allocation:
//  - `model.isDefault` is true while it's still following the default; saving then
//    creates a release-specific allocation that stops following it.
//  - `hasDefault && !model.isDefault` means the release has its own allocation and
//    can be reset to the default (which deletes the override, so it tracks the
//    default again). `loadedUpdatedAt` is the release's OWN allocation's version
//    (null while it's on the default).
export default function PortfolioDialog({
  releaseName, model, loadedUpdatedAt, hasDefault, saving, error, optionsError, onSave, onReset, onCancel,
}) {
  const { rows, hasActuals, totalSp, unestimatedCount, sprintCount, newCount, removedCount, isDefault } = model;
  const [values, setValues] = useState(() => initialAllocationValues(rows));
  const [confirmReset, setConfirmReset] = useState(false);

  const parsedState = parseAllocationValues(rows, values);
  const canSave = parsedState.allValid && !parsedState.over && !saving;
  const canReset = hasDefault && !isDefault;

  const handleSave = () => {
    onSave({ ...allocationPayload(rows, parsedState.parsed), expectedUpdatedAt: loadedUpdatedAt });
  };

  return (
    <div onClick={onCancel} style={S.dialogOverlay}>
      <div onClick={e => e.stopPropagation()} style={{ ...S.dialogBox, width: 600, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={S.dialogTitle}>Portfolio allocation — {releaseName}</div>
        <div style={{ ...S.hint, marginTop: 4 }}>
          Set the share of this release's work you want in each category. Targets can add up to 100% or less.
        </div>

        {isDefault && (
          <div style={{ ...S.notice, marginTop: 12 }}>
            This release is using the space's <strong>default distribution</strong>. If you save changes here it gets
            its own allocation and stops following the default; "Reset to default" undoes that.
          </div>
        )}
        {newCount > 0 && (
          <div style={{ ...S.notice, marginTop: 12 }}>
            {newCount} option{newCount === 1 ? ' was' : 's were'} added in Jira since this {isDefault ? 'default' : 'release'} was last saved. {newCount === 1 ? 'It is' : 'They are'} at 0% until you allocate {newCount === 1 ? 'it' : 'them'}, so any work tagged with {newCount === 1 ? 'it' : 'them'} shows as out of range.
          </div>
        )}
        {removedCount > 0 && (
          <div style={{ ...S.notice, marginTop: 12 }}>
            {removedCount} categor{removedCount === 1 ? 'y is' : 'ies are'} no longer an option in Jira but still {removedCount === 1 ? 'has' : 'have'} an allocation or tickets. Clear the allocation once it's no longer needed.
          </div>
        )}
        {optionsError && (
          <div style={{ ...S.notice, marginTop: 12 }}>
            Couldn't list the field's current options ({optionsError}). Showing categories already saved or found on tickets.
          </div>
        )}

        <AllocationEditor
          model={model}
          values={values}
          onChange={(id, v) => setValues(cur => ({ ...cur, [id]: v }))}
          parsedState={parsedState}
        />

        <div style={{ ...S.hint, marginTop: 12 }}>
          {model.basis === 'committed'
            ? (hasActuals
                ? <>Actual = this release's Total Committed ({totalSp} SP across {sprintCount} sprint{sprintCount === 1 ? '' : 's'}), split by category when each sprint's SP Count was taken.{model.thresholdCapacity > 0 ? <> Target SP = target % of Threshold Capacity ({Math.round(model.thresholdCapacity * 10) / 10} SP).</> : null}</>
                : <>Actual shares appear once the release's sprints have a Committed SP count.</>)
            : (hasActuals
                ? <>Actual = current story points of every ticket in the {sprintCount} sprint{sprintCount === 1 ? '' : 's'} mapped to this release ({totalSp} SP in total).</>
                : <>Actual shares appear once tickets are in this release's sprints.</>)}
          {' '}Tickets with no estimate count 0 SP{unestimatedCount > 0 ? ` (${unestimatedCount} right now)` : ''}.
          {model.basis === 'committed' && model.sprintsMissingSplit > 0 ? ` ${model.sprintsMissingSplit} sprint${model.sprintsMissingSplit === 1 ? ' has' : 's have'} no category breakdown yet — click Get SP Count on ${model.sprintsMissingSplit === 1 ? 'it' : 'them'}; until then that SP shows as Unassigned.` : ''}
        </div>

        {error && <div style={{ ...S.error, marginTop: 12 }}>{error}</div>}

        {confirmReset && (
          <div style={{ ...S.notice, marginTop: 12 }}>
            Discard this release's own allocation and use the space default instead? This can't be undone.
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button style={S.smallBtn} disabled={saving} onClick={() => onReset({ expectedUpdatedAt: loadedUpdatedAt })}>Reset to default</button>
              <button style={S.smallBtn} disabled={saving} onClick={() => setConfirmReset(false)}>Keep my allocation</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 20 }}>
          <div>
            {canReset && !confirmReset && (
              <button
                onClick={() => setConfirmReset(true)}
                disabled={saving}
                title="Remove this release's own allocation so it follows the space default again"
                style={{ ...S.smallBtn, padding: '7px 12px', fontSize: 12 }}
              >
                Reset to default
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onCancel} disabled={saving} style={{ ...S.btn, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-subtle)' }}>Cancel</button>
            <button onClick={handleSave} disabled={!canSave} style={{ ...S.btn, opacity: canSave ? 1 : 0.5 }}>
              {saving ? 'Saving…' : 'Save allocation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
