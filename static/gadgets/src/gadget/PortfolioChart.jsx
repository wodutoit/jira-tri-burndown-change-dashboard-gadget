import React from 'react';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { buildPortfolioRows, fmtPct, rowTooltip, STATUS_WORD } from './portfolioModel';
import { portfolioBands } from './gadgetUtils';

// Category identity colours. Status (green/orange/red) is NEVER used to colour a
// slice — it only appears as dots/bars/text — so a category keeps the same hue
// in every chart, and "is this on target" is a separate visual channel.
const CATEGORY_COLORS = ['#2684FF', '#6554C0', '#00B8D9', '#E774BB', '#FF991F', '#4C9AFF', '#8777D9', '#36B37E', '#FFC400', '#79E2F2'];
const UNASSIGNED_COLOR = '#C9372C';
const NEUTRAL = '#8590A2';

export const STATUS_FILL = { ok: 'var(--ok)', warn: 'var(--filling)', critical: 'var(--over)', none: 'var(--text-subtlest)' };
const STATUS_RANK = { critical: 0, warn: 1, ok: 2, none: 3 };

const nameKey = (n) => String(n ?? '').trim().toLowerCase();

// One stable colour per category NAME across every chart in the gadget (sorted
// so the assignment doesn't depend on which chart happens to be first).
export function buildColorMap(datasets) {
  const names = new Map();
  for (const d of datasets) {
    for (const c of Object.values(d?.categories ?? {})) names.set(nameKey(c.name), c.name);
    for (const [id, nm] of Object.entries(d?.names ?? {})) if (d.alloc?.[id] != null) names.set(nameKey(nm), nm);
  }
  const sorted = [...names.keys()].sort();
  const map = new Map(sorted.map((k, i) => [k, CATEGORY_COLORS[i % CATEGORY_COLORS.length]]));
  return (name) => map.get(nameKey(name)) ?? NEUTRAL;
}

export function modelFor(data) {
  return buildPortfolioRows({
    options: [], optionsLoaded: false,
    allocation: data.hasAllocation ? { alloc: data.alloc, names: data.names } : null,
    actuals: { totalSp: data.totalSp, categories: data.categories, unassigned: data.unassigned, unestimatedCount: data.unestimatedCount, sprintCount: data.sprintCount },
    thresholds: data.thresholds,
  });
}

function StatusDot({ status }) {
  return (
    <span
      title={STATUS_WORD[status]} aria-label={STATUS_WORD[status]}
      style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: STATUS_FILL[status], flex: 'none' }}
    />
  );
}

function TipBox({ active, payload }) {
  if (!active || !payload?.length) return null;
  const tip = payload[0].payload?.tip;
  if (!tip) return null;
  return (
    <div style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 9px', fontSize: 11, whiteSpace: 'pre-line', boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}>
      {tip}
    </div>
  );
}

// Donut: outer ring = actual share of story points, inner ring = target
// allocation (same category colours, so matching angles = on target). A grey
// arc on the inner ring is the unallocated remainder.
function Donut({ model, colorFor }) {
  const { rows, unassigned, hasActuals, hasSaved, totalSp, allocatedTotal } = model;

  const actualData = hasActuals
    ? [
        ...rows.filter(r => r.actualSp > 0).map(r => ({ name: r.name, value: r.actualSp, fill: colorFor(r.name), tip: rowTooltip(r, totalSp) })),
        ...(unassigned.actualSp > 0 ? [{ name: 'Unassigned', value: unassigned.actualSp, fill: UNASSIGNED_COLOR, tip: `Unassigned\nActual: ${fmtPct(unassigned.actualPct)} (${unassigned.actualSp} of ${totalSp} SP)\nTarget: 0%\nStatus: ${STATUS_WORD[unassigned.status]}` }] : []),
      ]
    : [{ name: 'No tickets yet', value: 1, fill: NEUTRAL, tip: 'No tickets in this release\'s sprints yet' }];

  const targetData = hasSaved
    ? [
        ...rows.filter(r => r.target > 0).map(r => ({ name: r.name, value: r.target, fill: colorFor(r.name), tip: `${r.name}\nTarget: ${fmtPct(r.target)}` })),
        ...(allocatedTotal < 100 ? [{ name: 'Unallocated', value: Math.round((100 - allocatedTotal) * 10) / 10, fill: NEUTRAL, tip: `Unallocated: ${Math.round((100 - allocatedTotal) * 10) / 10}%` }] : []),
      ]
    : [];

  return (
    <div style={{ position: 'relative', width: 200, height: 200, margin: '0 auto' }}>
      <PieChart width={200} height={200}>
        <Pie data={actualData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} startAngle={90} endAngle={-270} paddingAngle={actualData.length > 1 ? 1 : 0} stroke="none" isAnimationActive={false}>
          {actualData.map((d, i) => <Cell key={i} fill={d.fill} />)}
        </Pie>
        {targetData.length > 0 && (
          <Pie data={targetData} dataKey="value" nameKey="name" innerRadius={38} outerRadius={56} startAngle={90} endAngle={-270} paddingAngle={targetData.length > 1 ? 1 : 0} stroke="none" isAnimationActive={false}>
            {targetData.map((d, i) => <Cell key={i} fill={d.fill} fillOpacity={d.name === 'Unallocated' ? 0.35 : 0.9} />)}
          </Pie>
        )}
        <Tooltip content={<TipBox />} />
      </PieChart>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{totalSp}</span>
        <span style={{ fontSize: 9, color: 'var(--text-subtlest)', textTransform: 'uppercase', letterSpacing: '.4px' }}>SP</span>
      </div>
    </div>
  );
}

// Bullet bars: one row per category — bar = actual share (coloured by status),
// tick = target, shaded bands = the green and orange zones around that target,
// so how far out of range a category is reads without doing arithmetic. Worst
// first; Unassigned last.
function Bullets({ model, thresholds }) {
  const { rows, unassigned, hasActuals, hasSaved, totalSp } = model;
  const list = rows
    .filter(r => r.target > 0 || r.actualSp > 0)
    .sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status])
      || (Math.abs((b.actualPct ?? 0) - b.target) - Math.abs((a.actualPct ?? 0) - a.target)));
  const all = unassigned.actualSp > 0 ? [...list, { ...unassigned, name: 'Unassigned' }] : list;
  const axisMax = Math.max(10, ...all.map(r => Math.max(r.actualPct ?? 0, r.target))) * 1.15;
  const at = (pct) => `${Math.max(0, Math.min(100, (pct / axisMax) * 100))}%`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {all.map(r => {
        const bands = hasSaved && r.target > 0 ? portfolioBands(r.target, thresholds.warnPct, thresholds.criticalPct, thresholds.minTolerancePp) : null;
        const band = (pp) => ({ left: at(r.target - pp), width: `${Math.max(0, (Math.min(r.target + pp, axisMax) - Math.max(r.target - pp, 0)) / axisMax) * 100}%` });
        return (
          <div key={r.id} title={rowTooltip(r, totalSp)} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
              <span style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
                {hasActuals ? fmtPct(r.actualPct) : '—'} vs {hasSaved ? fmtPct(r.target) : '—'} <StatusDot status={r.status} />
              </span>
            </div>
            <div style={{ position: 'relative', height: 14, borderRadius: 3, background: 'var(--surface-sunken)', border: '1px solid var(--border)' }}>
              {bands && <div style={{ position: 'absolute', top: 0, bottom: 0, ...band(bands.criticalPp), background: 'var(--filling-bg)' }} />}
              {bands && <div style={{ position: 'absolute', top: 0, bottom: 0, ...band(bands.warnPp), background: 'var(--ok-bg)' }} />}
              {hasActuals && (
                <div style={{ position: 'absolute', left: 0, top: 3, bottom: 3, width: at(r.actualPct ?? 0), background: STATUS_FILL[r.status], borderRadius: 2, opacity: 0.95 }} />
              )}
              {hasSaved && r.target > 0 && (
                <div style={{ position: 'absolute', top: -2, bottom: -2, left: at(r.target), width: 2, marginLeft: -1, background: 'var(--text)' }} />
              )}
            </div>
          </div>
        );
      })}
      {all.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-subtlest)' }}>No data to show.</div>}
    </div>
  );
}

function LegendTable({ model, colorFor }) {
  const { rows, unassigned, hasSaved, hasActuals, totalSp } = model;
  const list = rows.filter(r => r.target > 0 || r.actualSp > 0);
  const cell = { padding: '3px 6px', fontSize: 11, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
      <thead>
        <tr>
          <th style={{ ...cell, textAlign: 'left', fontWeight: 700 }}>Category</th>
          <th style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>Actual</th>
          <th style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>Target</th>
          <th style={cell} />
        </tr>
      </thead>
      <tbody>
        {list.map(r => (
          <tr key={r.id} title={rowTooltip(r, totalSp)}>
            <td style={{ ...cell, color: 'var(--text)' }}>
              <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: colorFor(r.name), marginRight: 6 }} />{r.name}
            </td>
            <td style={{ ...cell, textAlign: 'right' }}>{hasActuals ? `${fmtPct(r.actualPct)} · ${r.actualSp} SP` : '—'}</td>
            <td style={{ ...cell, textAlign: 'right' }}>{hasSaved ? fmtPct(r.target) : '—'}</td>
            <td style={cell}><StatusDot status={r.status} /></td>
          </tr>
        ))}
        {unassigned.actualSp > 0 && (
          <tr title={`Unassigned: no portfolio category on these tickets. Target is always 0%.`}>
            <td style={{ ...cell, color: 'var(--over-text)', fontWeight: 600 }}>
              <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: UNASSIGNED_COLOR, marginRight: 6 }} />Unassigned
            </td>
            <td style={{ ...cell, textAlign: 'right' }}>{`${fmtPct(unassigned.actualPct)} · ${unassigned.actualSp} SP`}</td>
            <td style={{ ...cell, textAlign: 'right' }}>0%</td>
            <td style={cell}><StatusDot status={unassigned.status} /></td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// One card: title, optional subtitle/badge, the chart in the chosen style, and
// footnotes (no allocation set, tickets counted as 1 SP, spaces left out of a
// Total's target).
export default function PortfolioChart({ title, subtitle, badge, data, chartStyle, colorFor, notes = [] }) {
  const model = modelFor(data);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, minWidth: 250, flex: '1 1 260px', maxWidth: 420, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: 'var(--text-subtlest)' }}>{subtitle}</div>}
        </div>
        {badge && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.4px', padding: '1px 7px', borderRadius: 3, background: badge.bg, color: badge.text, flex: 'none' }}>{badge.label}</span>}
      </div>

      {chartStyle === 'bullet'
        ? <Bullets model={model} thresholds={data.thresholds} />
        : <><Donut model={model} colorFor={colorFor} /><LegendTable model={model} colorFor={colorFor} /></>}

      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!model.hasSaved && <span style={{ fontSize: 10, color: 'var(--text-subtlest)' }}>No portfolio allocation set for this release — showing actuals only.</span>}
        {model.unestimatedCount > 0 && <span style={{ fontSize: 10, color: 'var(--text-subtlest)' }}>{model.unestimatedCount} unestimated ticket{model.unestimatedCount === 1 ? '' : 's'} counted as 1 SP</span>}
        {notes.map((n, i) => <span key={i} style={{ fontSize: 10, color: 'var(--text-subtlest)' }}>{n}</span>)}
      </div>
    </div>
  );
}
