import React, { useState } from 'react';
import { view } from '@forge/bridge';
import { editStyles as S, DisplayModeSection } from './sprintConfigShared';
import { useSprintSourceConfig } from './useSprintSourceConfig';
import SprintSourceFields from './SprintSourceFields';

export default function TriReworkGadgetEdit() {
  const cfg = useSprintSourceConfig();
  const [displayMode, setDisplayMode] = useState('chart');
  const [saving, setSaving] = useState(false);
  const [hydratedDisplayMode, setHydratedDisplayMode] = useState(false);

  // Pull the saved displayMode out once initialConfig has loaded.
  if (!hydratedDisplayMode && cfg.initialConfig) {
    if (cfg.initialConfig.displayMode) setDisplayMode(cfg.initialConfig.displayMode);
    setHydratedDisplayMode(true);
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await view.submit({ ...cfg.getSourcePayload(), displayMode });
    } finally {
      setSaving(false);
    }
  };

  if (cfg.loading) return <div style={{ padding: 20, fontFamily: 'inherit' }}>Loading…</div>;

  return (
    <div style={S.wrap}>
      {cfg.error && <div style={S.error}>{cfg.error}</div>}

      <SprintSourceFields {...cfg} />

      <div style={S.divider} />

      <DisplayModeSection
        title="6. Display As"
        displayMode={displayMode}
        setDisplayMode={setDisplayMode}
        hint='Chart shows daily rework event count. Table lists every rework event ("Sprint Rework Events") — a ticket leaving a Test-phase status to anywhere other than Done.'
      />

      <div style={S.divider} />

      <button onClick={handleSave} disabled={saving || !cfg.canSave} style={{
        ...S.btn,
        opacity: (!cfg.canSave || saving) ? 0.5 : 1,
        cursor: (!cfg.canSave || saving) ? 'default' : 'pointer',
      }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
