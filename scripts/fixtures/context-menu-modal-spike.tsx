// Browser-only research fixture: imports the actual product component and CSS.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextMenu } from '../../apps/web/src/components/ui/ContextMenu';
import '../../apps/web/src/styles/theme.css';

function Probe() {
  const [menu, setMenu] = useState({ open: false, x: 0, y: 0 });
  const [actions, setActions] = useState(0);
  const [outside, setOutside] = useState(0);
  const [otherMenu, setOtherMenu] = useState({ open: false, x: 0, y: 0 });
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  const open = (x: number, y: number) => setMenu({ open: true, x, y });
  return <>
    <input id="field" defaultValue="Native Cut Copy Paste" />
    <button id="outside" onClick={() => setOutside(n => n + 1)}>Outside {outside}</button>
    <button id="keyboard" onClick={() => open(300, 200)}>Open app menu</button>
    <output id="actions">{actions}</output>
    <div id="other-surface" style={{ position: 'absolute', left: 650, top: 10, width: 120, height: 40 }}
      onContextMenu={event => {
        event.preventDefault();
        setOtherMenu({ open: true, x: event.clientX, y: event.clientY });
      }}>Other surface</div>
    <ContextMenu {...otherMenu} onOpenChange={open => setOtherMenu(menu => ({ ...menu, open }))}
      items={[{ kind: 'action', id: 'other', label: 'Other action', onSelect: () => {} }]} />
    <canvas id="canvas" tabIndex={0}
      style={{ position: 'absolute', left: 0, top: 80, width: '100vw', height: 'calc(100vh - 80px)' }}
      onPointerDown={event => {
        if (event.button !== 2) return;
        event.preventDefault();
        press.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { press.current = null; }}
      onPointerUp={event => {
        if (press.current?.id !== event.pointerId) return;
        const start = press.current;
        press.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) open(event.clientX, event.clientY);
      }}
      onContextMenu={event => event.preventDefault()}
    />
    <ContextMenu {...menu} onOpenChange={open => setMenu(menu => ({ ...menu, open }))} items={[
      { kind: 'action', id: 'alpha', label: 'Alpha', onSelect: () => setActions(n => n + 1) },
      { kind: 'action', id: 'disabled', label: 'Disabled', disabled: true, onSelect: () => {} },
      { kind: 'submenu', id: 'styles', label: 'Styles', items: [
        { kind: 'action', id: 'paper', label: 'Paper', onSelect: () => setActions(n => n + 1) },
        { kind: 'action', id: 'wire', label: 'Wireframe', onSelect: () => setActions(n => n + 1) },
      ] },
    ]} />
  </>;
}
createRoot(document.getElementById('root')!).render(<Probe />);
