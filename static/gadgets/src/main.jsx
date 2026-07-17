import React from 'react';
import ReactDOM from 'react-dom/client';
import { view } from '@forge/bridge';
import './styles.css';
import TriBurndownGadgetView from './gadget/TriBurndownGadgetView';
import TriBurndownGadgetEdit from './gadget/TriBurndownGadgetEdit';

const GADGETS = {
  'sprint-tri-burndown-gadget': { view: TriBurndownGadgetView, edit: TriBurndownGadgetEdit },
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
