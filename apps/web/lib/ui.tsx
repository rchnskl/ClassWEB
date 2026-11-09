'use client';

import { createContext, useContext, useState } from 'react';
import { useLocalStorage, writeLocalStorage } from './local-store';

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
  const sidebarCollapsed = useLocalStorage(COLLAPSE_KEY) === '1';

  function setSidebarCollapsed(collapsed: boolean) {
    writeLocalStorage(COLLAPSE_KEY, collapsed ? '1' : '0');
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
