import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { TeamsProvider } from './context/TeamsContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TeamsProvider>
      <App />
    </TeamsProvider>
  </StrictMode>,
);
