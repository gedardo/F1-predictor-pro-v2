

import React, { createContext, useState, ReactNode, useContext, useCallback } from 'react';

export interface LogEntry {
  timestamp: Date;
  table: string;
  operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'UPSERT' | 'AUTH' | 'FUNCTION' | 'RPC' | 'STORAGE' | 'OTHER';
  summary?: string;
  status: 'success' | 'error' | 'info'; // Added 'info'
  error?: string;
  durationMs?: number;
}

interface LoggingContextType {
  logs: LogEntry[];
  addLog: (log: Omit<LogEntry, 'timestamp' | 'durationMs'> & { startTime?: number }) => void;
  clearLogs: () => void;
}

const LoggingContext = createContext<LoggingContextType | undefined>(undefined);

export const LoggingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback((log: Omit<LogEntry, 'timestamp' | 'durationMs'> & { startTime?: number }) => {
    const { startTime, ...restOfLog } = log;
    const durationMs = startTime ? Date.now() - startTime : undefined;
    setLogs(prevLogs => [{ ...restOfLog, durationMs, timestamp: new Date() }, ...prevLogs.slice(0, 199)]); // Keep last 200 logs
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  return (
    <LoggingContext.Provider value={{ logs, addLog, clearLogs }}>
      {children}
    </LoggingContext.Provider>
  );
};

export const useLogger = (): LoggingContextType => {
  const context = useContext(LoggingContext);
  if (!context) {
    throw new Error('useLogger must be used within a LoggingProvider');
  }
  return context;
};