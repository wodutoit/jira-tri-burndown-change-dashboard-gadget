import React, { useState } from 'react';
import { view } from '@forge/bridge';
import { editStyles as S } from './sprintConfigShared';
import { useSprintSourceConfig } from './useSprintSourceConfig';
import SprintSourceFields from './SprintSourceFields';

export default function TriBurndownGadgetEdit() {
  const cfg = useSprintSourceConfig();
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await view.submit(cfg.getSourcePayload());
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
