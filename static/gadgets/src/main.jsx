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

const GADGETS = {
  'sprint-tri-burndown-gadget': { view: TriBurndownGadgetView, edit: TriBurndownGadgetEdit },
  'sprint-tri-scope-change-gadget': { view: TriScopeChangeGadgetView, edit: TriScopeChangeGadgetEdit },
  'sprint-tri-rework-gadget': { view: TriReworkGadgetView, edit: TriReworkGadgetEdit },
  'sprint-tri-cycle-time-gadget': { view: TriCycleTimeGadgetView, edit: TriCycleTimeGadgetEdit },
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
