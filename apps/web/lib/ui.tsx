'use client';

import { createContext, useContext, useState } from 'react';

interface UIContextValue {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

const UIContext = createContext<UIContextValue>({ sidebarOpen: false, setSidebarOpen: () => {} });

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return <UIContext.Provider value={{ sidebarOpen, setSidebarOpen }}>{children}</UIContext.Provider>;
}

export function useUI() {
  return useContext(UIContext);
}
