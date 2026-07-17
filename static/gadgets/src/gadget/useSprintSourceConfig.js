import { useState, useEffect, useCallback } from 'react';
import { invoke, view } from '@forge/bridge';
import { DEFAULT_PHASE_MAP } from './sprintConfigShared';

// Shared state + data-loading for the Space -> Sprint -> SP Field -> Status
// Mapping config flow used by every TRI-* gadget's edit screen. Each gadget's
// own Edit component owns any widget-specific fields (e.g. display mode) and
// composes those on top of what this hook returns.
export function useSprintSourceConfig() {
  const [projects, setProjects] = useState([]);
  const [fields, setFields]     = useState([]);
  const [sprints, setSprints]   = useState([]);
  const [statuses, setStatuses] = useState([]);

  const [projectKey, setProjectKey]       = useState('');
  const [sprintId, setSprintId]           = useState('active');
  const [spFieldId, setSpFieldId]         = useState('');
  const [statusMapping, setStatusMapping] = useState({});

  const [loading, setLoading]                 = useState(true);
  const [sprintsLoading, setSprintsLoading]   = useState(false);
  const [statusesLoading, setStatusesLoading] = useState(false);
  const [error, setError]                     = useState(null);
  const [initialConfig, setInitialConfig]     = useState(null);

  const loadSpaceData = useCallback(async (key) => {
    setSprintsLoading(true);
    setStatusesLoading(true);
    const [sprintRes, statusRes] = await Promise.all([
      invoke('getSprintsForProject', { projectKey: key }),
      invoke('getProjectStatuses', { projectKey: key }),
    ]);
    setSprints(sprintRes.sprints ?? []);
    setStatuses(statusRes.statuses ?? []);
    setSprintsLoading(false);
    setStatusesLoading(false);
    return statusRes.statuses ?? [];
  }, []);

  useEffect(() => {
    view.theme.enable().catch(() => {});
    Promise.all([
      invoke('getGadgetProjects'),
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
        setSprintId(cfg.sprintMode === 'fixed' ? String(cfg.sprintId) : 'active');
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

  // User explicitly picked a different space — reset sprint/status choices to defaults.
  const onProjectChange = useCallback(async (key) => {
    setProjectKey(key);
    setSprintId('active');
    setStatusMapping({});
    setStatuses([]);
    setSprints([]);
    if (!key) return;

    const fetchedStatuses = await loadSpaceData(key);
    const mapping = {};
    for (const s of fetchedStatuses) mapping[s.name] = DEFAULT_PHASE_MAP[s.name] ?? 'backlog';
    setStatusMapping(mapping);
  }, [loadSpaceData]);

  const isFixed = sprintId !== 'active';
  const canSave = projectKey && sprintId && spFieldId && Object.keys(statusMapping).length > 0;

  function getSourcePayload() {
    const sprint = isFixed ? sprints.find(s => String(s.id) === sprintId) : null;
    return {
      projectKey,
      sprintMode: isFixed ? 'fixed' : 'active',
      sprintId: isFixed ? Number(sprintId) : null,
      sprintName: sprint?.name ?? '',
      spFieldId,
      statusMapping,
    };
  }

  return {
    projects, fields, sprints, statuses,
    projectKey, sprintId, spFieldId, statusMapping,
    loading, sprintsLoading, statusesLoading, error, initialConfig,
    setSprintId, setSpFieldId, setStatusMapping,
    onProjectChange, canSave, getSourcePayload,
  };
}
