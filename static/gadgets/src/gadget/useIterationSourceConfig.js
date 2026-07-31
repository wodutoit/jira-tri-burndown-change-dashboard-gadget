import { useState, useEffect, useCallback } from 'react';
import { invoke, view } from '@forge/bridge';
import { DEFAULT_PHASE_MAP } from './sprintConfigShared';

// Shared state + data-loading for the Space -> Iteration -> SP Field -> Status
// Mapping config flow used by every TRI-Kanban-* gadget's edit screen — the
// Kanban sibling of useSprintSourceConfig.js. Only Capacity-enabled Kanban
// spaces are offered (these gadgets have no meaning for a Scrum space, or one
// without Capacity's iterations feature turned on). There's no "dashboard
// sprint filter" concept here — TRI Sprint Filter is Scrum-sprint-specific.
export function useIterationSourceConfig() {
  const [projects, setProjects]     = useState([]);
  const [fields, setFields]         = useState([]);
  const [iterations, setIterations] = useState([]);
  const [statuses, setStatuses]     = useState([]);

  const [projectKey, setProjectKey]       = useState('');
  const [iterationId, setIterationId]     = useState('active');
  const [spFieldId, setSpFieldId]         = useState('');
  const [statusMapping, setStatusMapping] = useState({});

  const [loading, setLoading]                     = useState(true);
  const [iterationsLoading, setIterationsLoading] = useState(false);
  const [statusesLoading, setStatusesLoading]     = useState(false);
  const [error, setError]                         = useState(null);
  const [initialConfig, setInitialConfig]         = useState(null);

  const loadSpaceData = useCallback(async (key) => {
    setIterationsLoading(true);
    setStatusesLoading(true);
    const [iterRes, statusRes] = await Promise.all([
      invoke('getKanbanIterations', { projectKey: key }),
      invoke('getProjectStatuses', { projectKey: key }),
    ]);
    setIterations(iterRes.iterations ?? []);
    setStatuses(statusRes.statuses ?? []);
    setIterationsLoading(false);
    setStatusesLoading(false);
    return statusRes.statuses ?? [];
  }, []);

  useEffect(() => {
    view.theme.enable().catch(() => {});
    Promise.all([
      invoke('getCapacityEnabledProjects', { boardTypeFilter: 'kanban' }),
      invoke('getNumericFields'),
      view.getContext().catch(() => ({})),
    ]).then(async ([proj, numFields, ctx]) => {
      if (proj.error) setError(proj.error);
      setProjects(proj.projects ?? []);
      setFields(numFields.fields ?? []);

      const cfg = ctx?.extension?.gadgetConfiguration ?? {};
      setInitialConfig(cfg);
      if (cfg.spFieldId) setSpFieldId(cfg.spFieldId);

      if (cfg.projectKey) {
        setProjectKey(cfg.projectKey);
        setIterationId(cfg.iterationMode === 'fixed' ? String(cfg.iterationId) : 'active');
        const fetchedStatuses = await loadSpaceData(cfg.projectKey);
        if (cfg.statusMapping) {
          setStatusMapping(cfg.statusMapping);
        } else {
          const mapping = {};
          for (const s of fetchedStatuses) mapping[s.name] = DEFAULT_PHASE_MAP[s.name] ?? 'backlog';
          setStatusMapping(mapping);
        }
      }
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // User explicitly picked a different space — reset iteration/status choices to defaults.
  const onProjectChange = useCallback(async (key) => {
    setProjectKey(key);
    setIterationId('active');
    setStatusMapping({});
    setStatuses([]);
    setIterations([]);
    if (!key) return;

    const fetchedStatuses = await loadSpaceData(key);
    const mapping = {};
    for (const s of fetchedStatuses) mapping[s.name] = DEFAULT_PHASE_MAP[s.name] ?? 'backlog';
    setStatusMapping(mapping);
  }, [loadSpaceData]);

  const isFixed = iterationId !== 'active';
  const canSave = projectKey && iterationId && spFieldId && Object.keys(statusMapping).length > 0;

  function getSourcePayload() {
    const iteration = isFixed ? iterations.find(it => it.id === iterationId) : null;
    return {
      projectKey,
      iterationMode: isFixed ? 'fixed' : 'active',
      iterationId: isFixed ? iterationId : null,
      iterationName: iteration?.name ?? '',
      spFieldId,
      statusMapping,
    };
  }

  return {
    projects, fields, iterations, statuses,
    projectKey, iterationId, spFieldId, statusMapping,
    loading, iterationsLoading, statusesLoading, error, initialConfig,
    setIterationId, setSpFieldId, setStatusMapping,
    onProjectChange, canSave, getSourcePayload,
  };
}
