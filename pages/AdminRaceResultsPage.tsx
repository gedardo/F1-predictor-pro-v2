
import React, { useState, useEffect } from 'react';
import { useData } from '../contexts/DataContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { F1Race, F1Driver, AppRoute } from '../types';
import LoadingSpinner from '../components/LoadingSpinner';
import { CheckCircle, AlertTriangle, Save, Send, LogOut } from 'lucide-react';

const AdminRaceResultsPage: React.FC = () => {
  const { races, drivers, loadingData, updateRaceResults, triggerScoreCalculation, getRaceById, getTeamById } = useData();
  const { currentUser: authCurrentUser, logout } = useAuth();
  const navigate = useNavigate();
  
  const [selectedRaceId, setSelectedRaceId] = useState<string | null>(null);
  const [currentRaceData, setCurrentRaceData] = useState<F1Race | null>(null);

  // Form state
  const [polePosition, setPolePosition] = useState<string | null>(null);
  const [top10, setTop10] = useState<(string | null)[]>(Array(10).fill(null));
  const [fastestLap, setFastestLap] = useState<string | null>(null);
  const [driverOfTheDay, setDriverOfTheDay] = useState<string | null>(null);

  const [operationStatus, setOperationStatus] = useState<{ type: 'success' | 'error' | 'info' | 'loading', message: string } | null>(null);


  useEffect(() => {
    if (selectedRaceId) {
      const race = getRaceById(selectedRaceId);
      setCurrentRaceData(race || null);
      if (race) {
        setPolePosition(race.polePositionRealPilotId || null);
        const raceTop10 = race.raceTop10Real || [];
        const newTop10 = Array(10).fill(null);
        for(let i=0; i < Math.min(raceTop10.length, 10); i++) {
            newTop10[i] = raceTop10[i];
        }
        setTop10(newTop10);
        setFastestLap(race.fastestLapRealPilotId || null);
        setDriverOfTheDay(race.driverOfTheDayRealPilotId || null);
        setOperationStatus(null); // Clear status when race changes
      }
    } else {
      setCurrentRaceData(null);
      setPolePosition(null);
      setTop10(Array(10).fill(null));
      setFastestLap(null);
      setDriverOfTheDay(null);
      setOperationStatus(null);
    }
  }, [selectedRaceId, getRaceById]);

  const handleTop10Change = (driverId: string | null, index: number) => {
    const newTop10 = [...top10];
    newTop10[index] = driverId;
    setTop10(newTop10);
  };

  const handleSubmitResultsAndCalculateScores = async (e: React.FormEvent) => {
    e.preventDefault();
    setOperationStatus(null); // Clear previous status

    if (!selectedRaceId) {
      setOperationStatus({ type: 'error', message: "Por favor, selecciona una carrera." });
      return;
    }
    if (!polePosition) {
      setOperationStatus({ type: 'error', message: "Por favor, selecciona el piloto de la Pole Position." });
      return;
    }
    if (!fastestLap) {
      setOperationStatus({ type: 'error', message: "Por favor, selecciona el piloto con la Vuelta Rápida." });
      return;
    }
    if (!driverOfTheDay) {
      setOperationStatus({ type: 'error', message: "Por favor, selecciona el Piloto del Día." });
      return;
    }
    const filledTop10 = top10.filter(d => d !== null);
    if (new Set(filledTop10).size !== filledTop10.length) {
      setOperationStatus({ type: 'error', message: "No puede haber pilotos duplicados en el Top 10." });
      return;
    }
    // const allTop10Filled = top10.every(d => d !== null); // Optional: Allow partial Top 10

    setOperationStatus({ type: 'loading', message: "Guardando resultados..." });

    try {
      // 1. Save Results
      const resultsToSave: Partial<Pick<F1Race, 'polePositionRealPilotId' | 'raceTop10Real' | 'fastestLapRealPilotId' | 'driverOfTheDayRealPilotId'>> = {
        polePositionRealPilotId: polePosition,
        raceTop10Real: top10,
        fastestLapRealPilotId: fastestLap,
        driverOfTheDayRealPilotId: driverOfTheDay,
      };
      await updateRaceResults(selectedRaceId, resultsToSave);
      setOperationStatus({ type: 'loading', message: "Resultados guardados. Calculando puntuaciones..." });

      // 2. Trigger Score Calculation
      try {
        await triggerScoreCalculation(selectedRaceId);
        setOperationStatus({ type: 'success', message: "¡Resultados guardados y puntuaciones calculadas con éxito! Los rankings se actualizarán." });
      } catch (calcError: any) {
        console.error("Error calculating scores:", calcError);
        setOperationStatus({ type: 'error', message: `Resultados guardados, pero el cálculo de puntos falló: ${calcError.message || "Error desconocido en cálculo"}.` });
      }
    } catch (saveErrorMain: any) {
      console.error("Error saving results:", saveErrorMain);
      setOperationStatus({ type: 'error', message: `Error al guardar los resultados: ${saveErrorMain.message || "Error desconocido al guardar"}.` });
    }
  };
  
  const handleAdminLogout = async () => {
    await logout();
    navigate(AppRoute.Auth);
  };

  if (loadingData && races.length === 0) {
    return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner message="Cargando datos de carreras y pilotos..." /></div>;
  }
  
  const driverOptionsForSelect = [{ value: "", label: '-- Sin Seleccionar --' }, ...drivers.map(d => ({ value: d.id, label: `${d.name} (#${d.number}) - ${d.teamId ? getTeamById(d.teamId)?.name : 'N/A'}`}))];

  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8 relative">
      {authCurrentUser?.email === 'admin@admin.ejemplo.com' && (
        <div className="absolute top-4 right-4 z-50">
            <button
                onClick={handleAdminLogout}
                className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition-colors flex items-center"
            >
                <LogOut size={18} className="mr-2" />
                Cerrar Sesión (Admin)
            </button>
        </div>
      )}
      <header className="mb-8 text-center pt-8 sm:pt-0">
        <h1 className="text-3xl sm:text-4xl font-bold text-red-500">Cargar Resultados de Carrera (Admin)</h1>
        <p className="text-gray-300 mt-1">Ingresa los resultados oficiales para calcular las puntuaciones de los usuarios.</p>
      </header>

      <div className="max-w-3xl mx-auto bg-gray-800 p-6 sm:p-8 rounded-xl shadow-2xl">
        <div className="mb-6">
          <label htmlFor="raceSelect" className="block text-lg font-semibold text-red-400 mb-2">Seleccionar Carrera:</label>
          <select
            id="raceSelect"
            value={selectedRaceId || ""}
            onChange={(e) => setSelectedRaceId(e.target.value || null)}
            className="w-full p-3 bg-gray-700 border border-gray-600 rounded-md shadow-sm text-white focus:ring-red-500 focus:border-red-500"
            disabled={operationStatus?.type === 'loading'}
          >
            <option value="">-- Elige una Carrera --</option>
            {races.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(race => (
              <option key={race.id} value={race.id}>{race.name} ({new Date(race.date).toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' })})</option>
            ))}
          </select>
        </div>

        {selectedRaceId && currentRaceData && (
          <form onSubmit={handleSubmitResultsAndCalculateScores}>
            <h2 className="text-2xl font-semibold text-yellow-400 mb-4 border-b border-yellow-500 pb-2">Resultados para: {currentRaceData.name}</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label htmlFor="polePosition" className="block text-sm font-medium text-gray-300 mb-1">Pole Position:</label>
                <select id="polePosition" value={polePosition || ""} onChange={(e) => setPolePosition(e.target.value || null)} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md text-white" disabled={operationStatus?.type === 'loading'}>
                    {driverOptionsForSelect.map(opt => <option key={opt.label + "-pole"} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="fastestLap" className="block text-sm font-medium text-gray-300 mb-1">Vuelta Rápida:</label>
                 <select id="fastestLap" value={fastestLap || ""} onChange={(e) => setFastestLap(e.target.value || null)} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md text-white" disabled={operationStatus?.type === 'loading'}>
                    {driverOptionsForSelect.map(opt => <option key={opt.label + "-fl"} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
               <div>
                <label htmlFor="driverOfTheDay" className="block text-sm font-medium text-gray-300 mb-1">Piloto del Día:</label>
                 <select id="driverOfTheDay" value={driverOfTheDay || ""} onChange={(e) => setDriverOfTheDay(e.target.value || null)} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md text-white" disabled={operationStatus?.type === 'loading'}>
                    {driverOptionsForSelect.map(opt => <option key={opt.label + "-dotd"} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
            </div>

            <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-300 mb-2">Top 10 Carrera Principal:</h3>
                <div className="space-y-2">
                {top10.map((driverId, index) => (
                    <div key={index} className="flex items-center space-x-2">
                    <span className="font-medium text-gray-400 w-8 text-right pr-1">{index + 1}.</span>
                    <select 
                        value={driverId || ""} 
                        onChange={(e) => handleTop10Change(e.target.value || null, index)}
                        className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                        disabled={operationStatus?.type === 'loading'}
                    >
                        {driverOptionsForSelect.map(opt => <option key={`${opt.value}-top10-${index}`} value={opt.value}>{opt.label}</option>)}
                    </select>
                    </div>
                ))}
                </div>
            </div>
            
            {operationStatus && (
                <div className={`mb-4 p-3 rounded-md flex items-center text-sm
                    ${operationStatus.type === 'success' ? 'bg-green-900/50 text-green-300' : ''}
                    ${operationStatus.type === 'error' ? 'bg-red-900/50 text-red-300' : ''}
                    ${operationStatus.type === 'info' || operationStatus.type === 'loading' ? 'bg-blue-900/50 text-blue-300' : ''}
                `}>
                    {operationStatus.type === 'success' && <CheckCircle size={20} className="mr-2"/>}
                    {operationStatus.type === 'error' && <AlertTriangle size={20} className="mr-2"/>}
                    {operationStatus.type === 'loading' && <LoadingSpinner size="sm" />}
                    <span className={operationStatus.type === 'loading' ? 'ml-2' : ''}>{operationStatus.message}</span>
                </div>
            )}
            
            <div className="flex flex-col sm:flex-row justify-end space-y-3 sm:space-y-0 sm:space-x-4 mt-8">
                <button
                    type="submit"
                    disabled={operationStatus?.type === 'loading'}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg shadow-md transition-colors disabled:opacity-50 flex items-center justify-center"
                >
                    {operationStatus?.type === 'loading' ? (
                        <LoadingSpinner size="sm"/>
                    ) : (
                        <><Save className="mr-2"/> Guardar y Calcular Puntuaciones</>
                    )}
                </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default AdminRaceResultsPage;
