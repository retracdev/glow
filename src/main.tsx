import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startAccountWelcome } from './account/welcome';
import { onDispose } from './runtime';
import { App } from './ui/App';
import './ui/styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
// A live update replaces this run of Glow, so let React put the engine and everything away.
onDispose(() => root.unmount());

startAccountWelcome();
