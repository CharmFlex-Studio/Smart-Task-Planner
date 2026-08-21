import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { PlannerProvider } from './state.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <React.StrictMode>
    <PlannerProvider>
      <App />
    </PlannerProvider>
  </React.StrictMode>,
);
