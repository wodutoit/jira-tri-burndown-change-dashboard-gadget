import React, { useState } from 'react';
import { view } from '@forge/bridge';
import { editStyles as S, Section } from './sprintConfigShared';
import { useSprintSourceConfig } from './useSprintSourceConfig';
import SprintSourceFields from './SprintSourceFields';

const numInput = { ...S.select, width: 80, display: 'inline-block' };

export default function TriCycleTimeGadgetEdit() {
  const cfg = useSprintSourceConfig();
  const [hoursPerSp, setHoursPerSp]       = useState(4);
  const [workStartHour, setWorkStartHour] = useState(9);
  const [workEndHour, setWorkEndHour]     = useState(17);
  const [utcOffsetHours, setUtcOffsetHours] = useState(10);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Pull saved widget-specific fields once initialConfig has loaded.
  if (!hydrated && cfg.initialConfig) {
    const c = cfg.initialConfig;
    if (c.hoursPerSp != null) setHoursPerSp(c.hoursPerSp);
    if (c.workStartHour != null) setWorkStartHour(c.workStartHour);
    if (c.workEndHour != null) setWorkEndHour(c.workEndHour);
    if (c.utcOffsetHours != null) setUtcOffsetHours(c.utcOffsetHours);
    setHydrated(true);
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await view.submit({
        ...cfg.getSourcePayload(),
        hoursPerSp: Number(hoursPerSp),
        workStartHour: Number(workStartHour),
        workEndHour: Number(workEndHour),
        utcOffsetHours: Number(utcOffsetHours),
      });
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

      <Section title="6. Hours per Story Point">
        <input type="number" min="0.5" step="0.5" value={hoursPerSp}
               onChange={e => setHoursPerSp(e.target.value)} style={numInput} />
        <div style={S.hint}>Business hours that equal 1 story point (default 4h = 2 SP/day at 8h/day). Used to convert cycle time into an SP-equivalent for the "Total Cycle Time SP" column.</div>
      </Section>

      <div style={S.divider} />

      <Section title="7. Business Hours">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            Start hour
            <input type="number" min="0" max="23" value={workStartHour}
                   onChange={e => setWorkStartHour(e.target.value)} style={numInput} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            End hour
            <input type="number" min="0" max="23" value={workEndHour}
                   onChange={e => setWorkEndHour(e.target.value)} style={numInput} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            UTC offset
            <input type="number" min="-12" max="14" value={utcOffsetHours}
                   onChange={e => setUtcOffsetHours(e.target.value)} style={numInput} />
          </label>
        </div>
        <div style={S.hint}>Working hours window (24h, Monday–Friday) and fixed UTC offset used to compute business hours spent in each status. Defaults match 9am–5pm, UTC+10 (Sydney/AEST, no daylight saving). Only whole-hour offsets are supported.</div>
      </Section>

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
