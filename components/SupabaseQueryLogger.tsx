
import React, { useState } from 'react';
import { useLogger } from '../contexts/LoggingContext'; // Adjust path as necessary

const SupabaseQueryLogger: React.FC = () => {
  const { logs, clearLogs } = useLogger();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(true); // Start minimized

  const toggleOpen = () => {
    setIsOpen(!isOpen);
    if (isOpen) setIsMinimized(true); // Minimize when closing
    else setIsMinimized(false); // Open fully when opening
  }

  const formatLogTime = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (!isOpen) {
    return (
      <button
        onClick={toggleOpen}
        className="fixed bottom-4 right-4 bg-blue-600 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 z-[100] transition-transform hover:scale-110"
        aria-label="Open Query Logs"
        title="Open Query Logs"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h7.5M8.25 12h7.5m-7.5 5.25h7.5M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
        {logs.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-xs rounded-full px-1.5 py-0.5 animate-pulse">{logs.length}</span>}
      </button>
    );
  }

  return (
    <div className={`fixed inset-x-0 bottom-0 z-[99] p-3 shadow-2xl transition-all duration-300 ease-in-out ${isMinimized ? 'max-h-16' : 'max-h-[60vh]'} flex flex-col bg-gray-900 bg-opacity-95 backdrop-blur-md border-t-2 border-red-500`}>
      <div className="flex justify-between items-center mb-2 flex-shrink-0">
        <h3 className="text-md font-semibold text-red-400">Supabase Logs ({logs.length})</h3>
        <div>
          <button onClick={clearLogs} className="text-xs text-gray-400 hover:text-white mr-3 px-2 py-1 hover:bg-gray-700 rounded">Clear</button>
          <button onClick={() => setIsMinimized(!isMinimized)} className="text-gray-300 hover:text-white mr-3 px-2 py-1 hover:bg-gray-700 rounded" title={isMinimized ? "Expand" : "Minimize"}>
            {isMinimized ? 'Expand' : 'Minimize'}
          </button>
          <button onClick={toggleOpen} className="text-gray-300 hover:text-white px-2 py-1 hover:bg-gray-700 rounded" title="Close Logs">&times;</button>
        </div>
      </div>
      {!isMinimized && (
        <div className="overflow-y-auto flex-grow text-xs space-y-1 pr-2 custom-scrollbar">
          {logs.map((log, index) => (
            <details key={index} className="p-1.5 bg-gray-800 rounded-sm hover:bg-gray-700/70 transition-colors">
              <summary className={`cursor-pointer ${log.status === 'error' ? 'text-red-400' : 'text-green-400'} list-none flex justify-between items-center`}>
                <span>
                  [{formatLogTime(log.timestamp)}] {log.operation} on <span className="font-medium">{log.table}</span> - {log.status.toUpperCase()}
                  {log.durationMs && <span className="text-gray-500 text-xs"> ({log.durationMs}ms)</span>}
                </span>
                <span className="text-gray-500 text-xs details-arrow transform group-open:rotate-90 transition-transform">▼</span>
              </summary>
              <div className="pl-4 mt-1 text-gray-300 whitespace-pre-wrap break-words bg-gray-800/50 p-1 rounded">
                {log.summary && <p><span className="font-semibold text-gray-400">Summary:</span> {log.summary}</p>}
                {log.error && <p><span className="font-semibold text-red-300">Error:</span> {log.error}</p>}
              </div>
            </details>
          ))}
          {logs.length === 0 && <p className="text-gray-500 italic">No queries logged yet.</p>}
        </div>
      )}
       <style>{`
        details summary::-webkit-details-marker { display: none; }
        details summary .details-arrow { display: inline-block; transition: transform 0.2s; }
        details[open] summary .details-arrow { transform: rotate(90deg); }
      `}</style>
    </div>
  );
};

export default SupabaseQueryLogger;
