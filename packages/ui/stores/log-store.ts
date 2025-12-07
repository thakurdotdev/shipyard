import { create } from 'zustand';

interface LogStore {
  logs: Record<string, string>;
  appendLog: (buildId: string, chunk: string) => void;
  setLogs: (buildId: string, fullLog: string) => void;
  clearLogs: (buildId: string) => void;
}

export const useLogStore = create<LogStore>((set) => ({
  logs: {},
  appendLog: (buildId, chunk) =>
    set((state) => ({
      logs: {
        ...state.logs,
        [buildId]: (state.logs[buildId] || '') + chunk,
      },
    })),
  setLogs: (buildId, fullLog) =>
    set((state) => ({
      logs: {
        ...state.logs,
        [buildId]: fullLog,
      },
    })),
  clearLogs: (buildId) =>
    set((state) => {
      const newLogs = { ...state.logs };
      delete newLogs[buildId];
      return { logs: newLogs };
    }),
}));
