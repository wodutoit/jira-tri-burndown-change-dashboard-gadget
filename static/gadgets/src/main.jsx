import React from 'react';
import ReactDOM from 'react-dom/client';
import { view } from '@forge/bridge';
import './styles.css';
import TriBurndownGadgetView from './gadget/TriBurndownGadgetView';
import TriBurndownGadgetEdit from './gadget/TriBurndownGadgetEdit';
import TriScopeChangeGadgetView from './gadget/TriScopeChangeGadgetView';
import TriScopeChangeGadgetEdit from './gadget/TriScopeChangeGadgetEdit';
import TriReworkGadgetView from './gadget/TriReworkGadgetView';
import TriReworkGadgetEdit from './gadget/TriReworkGadgetEdit';
import TriCycleTimeGadgetView from './gadget/TriCycleTimeGadgetView';
import TriCycleTimeGadgetEdit from './gadget/TriCycleTimeGadgetEdit';
import TriSprintFilterGadgetView from './gadget/TriSprintFilterGadgetView';
import TriSprintFilterGadgetEdit from './gadget/TriSprintFilterGadgetEdit';
import TriVelocityGadgetView from './gadget/TriVelocityGadgetView';
import TriVelocityGadgetEdit from './gadget/TriVelocityGadgetEdit';
import TriReleaseCapacityGadgetView from './gadget/TriReleaseCapacityGadgetView';
import TriReleaseCapacityGadgetEdit from './gadget/TriReleaseCapacityGadgetEdit';
import TriCapacitySettingsPage from './gadget/TriCapacitySettingsPage';
import TriCapacityPage from './gadget/TriCapacityPage';
import TriKanbanBurnupGadgetView from './gadget/TriKanbanBurnupGadgetView';
import TriKanbanBurnupGadgetEdit from './gadget/TriKanbanBurnupGadgetEdit';
import TriKanbanReworkGadgetView from './gadget/TriKanbanReworkGadgetView';
import TriKanbanReworkGadgetEdit from './gadget/TriKanbanReworkGadgetEdit';
import TriKanbanCycleTimeGadgetView from './gadget/TriKanbanCycleTimeGadgetView';
import TriKanbanCycleTimeGadgetEdit from './gadget/TriKanbanCycleTimeGadgetEdit';

const GADGETS = {
  'sprint-tri-burndown-gadget': { view: TriBurndownGadgetView, edit: TriBurndownGadgetEdit },
  'sprint-tri-scope-change-gadget': { view: TriScopeChangeGadgetView, edit: TriScopeChangeGadgetEdit },
  'sprint-tri-rework-gadget': { view: TriReworkGadgetView, edit: TriReworkGadgetEdit },
  'sprint-tri-cycle-time-gadget': { view: TriCycleTimeGadgetView, edit: TriCycleTimeGadgetEdit },
  'sprint-tri-filter-gadget': { view: TriSprintFilterGadgetView, edit: TriSprintFilterGadgetEdit },
  'sprint-tri-velocity-gadget': { view: TriVelocityGadgetView, edit: TriVelocityGadgetEdit },
  'sprint-tri-release-capacity-gadget': { view: TriReleaseCapacityGadgetView, edit: TriReleaseCapacityGadgetEdit },
  'sprint-tri-kanban-burnup-gadget': { view: TriKanbanBurnupGadgetView, edit: TriKanbanBurnupGadgetEdit },
  'sprint-tri-kanban-rework-gadget': { view: TriKanbanReworkGadgetView, edit: TriKanbanReworkGadgetEdit },
  'sprint-tri-kanban-cycle-time-gadget': { view: TriKanbanCycleTimeGadgetView, edit: TriKanbanCycleTimeGadgetEdit },
  'tri-space-capacity-settings-page': { view: TriCapacitySettingsPage },
  'tri-space-capacity-page': { view: TriCapacityPage },
};

async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  const ctx = await view.getContext().catch(() => ({}));

  const gadget = GADGETS[ctx.moduleKey];
  if (!gadget) {
    root.render(<div style={{ padding: 16, fontFamily: 'inherit' }}>Unknown module: {ctx.moduleKey ?? '(none)'}</div>);
    return;
  }
  const Component = ctx.extension?.entryPoint === 'edit' ? gadget.edit : gadget.view;

  root.render(
    <React.StrictMode>
      <Component />
    </React.StrictMode>
  );
}

bootstrap();
