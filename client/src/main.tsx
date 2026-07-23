import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { getConfig } from './config';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}
const root = createRoot(rootElement);

// FEV-03: validate configuration before anything renders — fail loudly, not blankly.
let configError: Error | undefined;
try {
  getConfig();
} catch (error) {
  configError = error instanceof Error ? error : new Error(String(error));
}

root.render(
  <StrictMode>
    {configError ? (
      <main role="alert">
        <h1>Configuration error</h1>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{configError.message}</pre>
      </main>
    ) : (
      <App />
    )}
  </StrictMode>,
);
