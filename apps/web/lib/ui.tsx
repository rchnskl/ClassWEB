'use client';

import { createContext, useContext, useEffect, useState } from 'react';

interface UIContextValue {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const UIContext = createContext<UIContextValue>({
  sidebarOpen: false, setSidebarOpen: () => {},
  sidebarCollapsed: false, setSidebarCollapsed: () => {},
});

const COLLAPSE_KEY = 'sidebarCollapsed';

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(false);

  useEffect(() => {
    try { setSidebarCollapsedState(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch {}
  }, []);

  function setSidebarCollapsed(collapsed: boolean) {
    setSidebarCollapsedState(collapsed);
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch {}
  }

  return (
    <UIContext.Provider value={{ sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed }}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  return useContext(UIContext);
}
