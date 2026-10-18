import React, { useState } from 'react';
import { invoke } from '@forge/bridge';
import { editStyles as S } from './sprintConfigShared';

// "Save to Confluence" button for the Capacity tab. Sends the on-screen
// snapshot to saveCapacityToConfluence; if the space's "-Capacity Log" page
// already exists, asks whether to overwrite it or create a new (timestamped) one.
export default function SaveToConfluenceButton({ projectKey, getSnapshot }) {
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState(null); // { id, title, url } while asking
  const [result, setResult] = useState(null);     // { page, status }
  const [error, setError] = useState(null);

  const run = async (mode) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await invoke('saveCapacityToConfluence', { projectKey, snapshot: getSnapshot(), mode });
      if (res.error) { setError(res.error); setExisting(null); return; }
      if (res.status === 'exists') { setExisting(res.page); return; }
      setExisting(null);
      setResult(res);
    } catch (e) {
      setError(String(e.message || e));
      setExisting(null);
    } finally {
      setBusy(false);
    }
  };

  const verb = { created: 'Created', updated: 'Updated' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <button onClick={() => run('check')} disabled={busy} style={{ ...S.btn, opacity: busy ? 0.6 : 1 }}>
        {busy && !existing ? 'Saving…' : 'Save to Confluence'}
      </button>

      {result && (
        <div style={{ fontSize: 12, color: 'var(--ok-text)' }}>
          {verb[result.status] || 'Saved'}{' '}
          {result.page?.url
            ? <a href={result.page.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand)', fontWeight: 600 }}>{result.page.title}</a>
            : <strong>{result.page?.title}</strong>}
        </div>
      )}
      {error && <div style={{ ...S.error, maxWidth: 420 }}>{error}</div>}

      {existing && (
        <div onClick={() => !busy && setExisting(null)} style={S.dialogOverlay}>
          <div onClick={e => e.stopPropagation()} style={S.dialogBox}>
            <div style={S.dialogTitle}>Capacity Log page already exists</div>
            <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.5 }}>
              {existing.url
                ? <a href={existing.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand)', fontWeight: 600 }}>{existing.title}</a>
                : <strong>{existing.title}</strong>}{' '}
              is already in Confluence. Overwrite it with this snapshot, or keep it and create a new, timestamped page?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <button onClick={() => setExisting(null)} disabled={busy} style={{ ...S.btn, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-subtle)' }}>Cancel</button>
              <button onClick={() => run('new')} disabled={busy} style={{ ...S.btn, opacity: busy ? 0.6 : 1 }}>New page</button>
              <button onClick={() => run('overwrite')} disabled={busy} style={{ ...S.btn, opacity: busy ? 0.6 : 1 }}>Overwrite</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
