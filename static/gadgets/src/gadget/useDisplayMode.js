import { useState } from 'react';

// Shared view-mode logic for gadgets with a chart-or-table config choice.
// displayMode from config is one of: 'chart' | 'table' | 'both-2col' | 'both-1col'.
// For the single-mode cases, viewMode is local (session-only) state so the
// viewer can flip between chart/table without editing the gadget's config.
export function useDisplayMode(configDisplayMode) {
  const isBoth  = configDisplayMode === 'both-2col' || configDisplayMode === 'both-1col';
  const isTwoCol = configDisplayMode === 'both-2col';
  const [viewMode, setViewMode] = useState(configDisplayMode === 'table' ? 'table' : 'chart');

  const toggleViewMode = () => setViewMode(m => (m === 'chart' ? 'table' : 'chart'));

  return { isBoth, isTwoCol, viewMode, toggleViewMode };
}

export const bothLayoutStyle = {
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, alignItems: 'start' },
  oneCol: { display: 'flex', flexDirection: 'column', gap: 16 },
};
