
import React, { useState, useEffect } from 'react';
import { useData } from '../contexts/DataContext';
import { UserF1Team, AppRoute } from '../types';
import DriverSelectItem from '../components/DriverSelectItem';
import TeamSelectItem from '../components/TeamSelectItem';
import LoadingSpinner from '../components/LoadingSpinner';
import { MAX_DRIVERS_TEAM, MAX_CONSTRUCTORS_TEAM, DEFAULT_USER_F1_TEAM } from '../constants';
import { ShieldCheck, Users, Save, AlertTriangle, CheckCircle } from 'lucide-react';
import { Link } from 'react-router-dom';


const MyTeamPage: React.FC = () => {
  const { 
    drivers, teams, userF1Team, updateUserF1Team, 
    getTeamById, loadingData, loadingUserGameData 
  } = useData();
  
  const [selectedDrivers, setSelectedDrivers] = useState<(string | null)[]>(DEFAULT_USER_F1_TEAM.drivers);
  const [selectedConstructors, setSelectedConstructors] = useState<(string | null)[]>(DEFAULT_USER_F1_TEAM.constructors);
  const [changesRemaining, setChangesRemaining] = useState<number>(DEFAULT_USER_F1_TEAM.changesRemaining);
  
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    // Initialize form state from context once userF1Team is loaded
    setSelectedDrivers(userF1Team.drivers);
    setSelectedConstructors(userF1Team.constructors);
    setChangesRemaining(userF1Team.changesRemaining);
  }, [userF1Team]);

  const handleDriverSelect = (driverId: string) => {
    setError('');
    setSaveSuccess(false);
    const currentDrivers = selectedDrivers.filter(d => d !== null) as string[];
    if (currentDrivers.includes(driverId)) {
      setSelectedDrivers(prev => prev.map(d => (d === driverId ? null : d)));
    } else if (currentDrivers.length < MAX_DRIVERS_TEAM) {
      setSelectedDrivers(prev => {
        const newSelection = [...prev];
        const emptySlot = newSelection.findIndex(d => d === null);
        if (emptySlot !== -1) newSelection[emptySlot] = driverId;
        // else newSelection.push(driverId); // This case shouldn't be needed if initialized properly
        return newSelection.slice(0, MAX_DRIVERS_TEAM); 
      });
    } else {
      setError(`Solo puedes seleccionar ${MAX_DRIVERS_TEAM} pilotos.`);
    }
  };

  const handleConstructorSelect = (teamId: string) => {
    setError('');
    setSaveSuccess(false);
    const currentConstructors = selectedConstructors.filter(c => c !== null) as string[];
    if (currentConstructors.includes(teamId)) {
      setSelectedConstructors(prev => prev.map(c => (c === teamId ? null : c)));
    } else if (currentConstructors.length < MAX_CONSTRUCTORS_TEAM) {
       setSelectedConstructors(prev => {
        const newSelection = [...prev];
        const emptySlot = newSelection.findIndex(c => c === null);
        if (emptySlot !== -1) newSelection[emptySlot] = teamId;
        return newSelection.slice(0, MAX_CONSTRUCTORS_TEAM);
      });
    } else {
       setError(`Solo puedes seleccionar ${MAX_CONSTRUCTORS_TEAM} escuderías.`);
    }
  };

  const handleSaveChanges = async () => {
    setError('');
    setSaveSuccess(false);
    const filledDrivers = selectedDrivers.filter(d => d !== null).length;
    const filledConstructors = selectedConstructors.filter(c => c !== null).length;

    if (filledDrivers !== MAX_DRIVERS_TEAM || filledConstructors !== MAX_CONSTRUCTORS_TEAM) {
        setError(`Debes seleccionar ${MAX_DRIVERS_TEAM} pilotos y ${MAX_CONSTRUCTORS_TEAM} escuderías.`);
        return;
    }
    
    // Check if actual changes were made compared to the currently saved team in context
    const teamChanged = JSON.stringify(userF1Team.drivers) !== JSON.stringify(selectedDrivers) ||
                        JSON.stringify(userF1Team.constructors) !== JSON.stringify(selectedConstructors);

    if (teamChanged && changesRemaining <= 0) {
      setError('No te quedan cambios disponibles para esta temporada.');
      return;
    }
    
    setIsSaving(true);
    try {
      const newTeamData: UserF1Team = {
        drivers: selectedDrivers as [string|null, string|null, string|null, string|null],
        constructors: selectedConstructors as [string|null, string|null],
        changesRemaining: teamChanged ? Math.max(0, changesRemaining - 1) : changesRemaining,
      };
      await updateUserF1Team(newTeamData);
      // Local state for changesRemaining will be updated by useEffect via userF1Team prop change
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Error al guardar el equipo.');
    } finally {
      setIsSaving(false);
    }
  };
  
  if (loadingData || loadingUserGameData && !userF1Team.drivers.some(d => d !== null)) { // Show spinner if still loading crucial data
    return <LoadingSpinner message="Cargando datos del equipo..." />;
  }

  const isTeamComplete = selectedDrivers.filter(d => d !== null).length === MAX_DRIVERS_TEAM && 
                         selectedConstructors.filter(c => c !== null).length === MAX_CONSTRUCTORS_TEAM;
  
  const teamEffectivelyChanged = JSON.stringify(userF1Team.drivers) !== JSON.stringify(selectedDrivers) ||
                               JSON.stringify(userF1Team.constructors) !== JSON.stringify(selectedConstructors);


  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl mb-8 text-center">
        <h1 className="text-3xl font-bold text-red-500 mb-2">Configura tu Equipo F1</h1>
        <p className="text-gray-300">Selecciona {MAX_DRIVERS_TEAM} pilotos y {MAX_CONSTRUCTORS_TEAM} escuderías para la temporada 2025.</p>
        <p className="text-yellow-400 font-semibold mt-1">Cambios restantes: {changesRemaining}</p>
      </div>

      {error && <p className="mb-4 text-center text-red-400 bg-red-900/50 p-3 rounded-md flex items-center justify-center"><AlertTriangle size={20} className="mr-2"/>{error}</p>}
      {saveSuccess && <p className="mb-4 text-center text-green-400 bg-green-900/50 p-3 rounded-md flex items-center justify-center"><CheckCircle size={20} className="mr-2"/>¡Equipo guardado con éxito!</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section>
          <h2 className="text-2xl font-semibold text-red-400 mb-4 flex items-center"><Users className="mr-2"/>Selección de Pilotos ({selectedDrivers.filter(d => d !== null).length}/{MAX_DRIVERS_TEAM})</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto p-2 rounded bg-gray-800/30 custom-scrollbar">
            {drivers.map(driver => (
              <DriverSelectItem
                key={driver.id}
                driver={driver}
                team={getTeamById(driver.teamId || '')}
                isSelected={selectedDrivers.includes(driver.id)}
                onSelect={handleDriverSelect}
                disabled={selectedDrivers.filter(d => d !== null).length >= MAX_DRIVERS_TEAM && !selectedDrivers.includes(driver.id)}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold text-red-400 mb-4 flex items-center"><ShieldCheck className="mr-2"/>Selección de Escuderías ({selectedConstructors.filter(c => c !== null).length}/{MAX_CONSTRUCTORS_TEAM})</h2>
          <div className="grid grid-cols-1 gap-4 max-h-[70vh] overflow-y-auto p-2 rounded bg-gray-800/30 custom-scrollbar">
            {teams.map(team => (
              <TeamSelectItem
                key={team.id}
                team={team}
                isSelected={selectedConstructors.includes(team.id)}
                onSelect={handleConstructorSelect}
                disabled={selectedConstructors.filter(c => c !== null).length >= MAX_CONSTRUCTORS_TEAM && !selectedConstructors.includes(team.id)}
              />
            ))}
          </div>
        </section>
      </div>
      
      <div className="mt-10 text-center">
         <button
          onClick={handleSaveChanges}
          disabled={
            !isTeamComplete || 
            isSaving || 
            (teamEffectivelyChanged && changesRemaining <= 0 && userF1Team.changesRemaining <=0) || // if changes were made AND no changes left from start
            (!teamEffectivelyChanged && isTeamComplete) // Disable if team is complete but no changes made
          }
          className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-lg shadow-lg text-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center mx-auto"
        >
          {isSaving ? <LoadingSpinner size="sm"/> : <Save className="mr-2" />} 
          {isSaving ? 'Guardando...' : 'Guardar Mi Equipo'}
        </button>
      </div>
       <div className="mt-8 text-center">
        <Link to={AppRoute.Rules} className="text-red-400 hover:text-red-300 underline">
          ¿Cómo se puntúa mi equipo F1?
        </Link>
      </div>
    </div>
  );
};

export default MyTeamPage;
