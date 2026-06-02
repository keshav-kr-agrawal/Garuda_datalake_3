import React from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopWebDashboard } from './components/DesktopWebDashboard';
import { MediaPipeCheck } from './components/MediaPipeCheck';
import { MobileFaceNetCheck } from './components/MobileFaceNetCheck';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  
  const params = new URLSearchParams(window.location.search);
  const mode   = params.get('mode');

  let Component: React.ReactElement;
  if      (mode === 'test')    Component = <MediaPipeCheck />;
  else if (mode === 'facenet') Component = <MobileFaceNetCheck />;
  else                          Component = <DesktopWebDashboard />;

  root.render(
    <React.StrictMode>
      {Component}
    </React.StrictMode>
  );
}

