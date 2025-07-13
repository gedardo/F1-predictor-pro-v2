
import React, { useState, useEffect }from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useData } from '../contexts/DataContext';
import { Prediction, F1Race, AppRoute } from '../types';
import PredictionInput from '../components/PredictionInput';
import LoadingSpinner from '../components/LoadingSpinner';
import { F1_DRIVERS_2025, PREDICTION_CLOSE_HOURS_BEFORE } from '../constants'; 
import { CheckCircle, AlertTriangle, Save } from 'lucide-react';

const PredictionPage: React.FC = () => {
  const { raceId } = useParams<{ raceId: string }>();
  const navigate = useNavigate();
  const { getRaceById, savePrediction, getPredictionForRace, loadingData, loadingUserGameData } = useData();

  const [race, setRace] = useState<F1Race | null>(null);
  const [currentPrediction, setCurrentPrediction] = useState<Prediction | null>(null);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true); // For initial race and prediction setup
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPredictionLocked, setIsPredictionLocked] = useState(false);


  useEffect(() => {
    if (raceId) {
      const foundRace = getRaceById(raceId);
      if (foundRace) {
        setRace(foundRace);
        const existingPrediction = getPredictionForRace(raceId);
        const initialPrediction: Prediction = existingPrediction || {
          raceId: raceId,
          qualifyingTop3: [null, null, null],
          sprintTop3: foundRace.isSprintWeekend ? [null, null, null] : undefined,
          raceTop10: [null, null, null, null, null, null, null, null, null, null],
          fastestLap: null,
          driverOfTheDay: null,
        };
        setCurrentPrediction(initialPrediction);
        
        if (foundRace.sessions?.qualifying) {
            const deadline = new Date(foundRace.sessions.qualifying); 
            deadline.setHours(deadline.getHours() - PREDICTION_CLOSE_HOURS_BEFORE);
            if (new Date() > deadline) {
                setIsPredictionLocked(true);
            }
        } else {
            // If session data is missing, assume predictions are locked as a fallback
            // or handle as an error that race data is incomplete
            setIsPredictionLocked(true); 
            console.warn(`Race ${raceId} is missing session data. Predictions locked.`);
        }


      } else {
        navigate(AppRoute.Calendar); 
      }
    }
    setIsLoadingInitial(false);
  }, [raceId, getRaceById, getPredictionForRace, navigate]);

  const handlePredictionChange = <K extends keyof Prediction,>(field: K, value: Prediction[K]) => {
    if (currentPrediction) {
      setSaveSuccess(false); // Reset success message on change
      setSaveError(null);    // Reset error message on change
      setCurrentPrediction(prev => ({ ...prev!, [field]: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPrediction || !race) return;

    if (isPredictionLocked) {
      setSaveError("Las predicciones para esta carrera están cerradas.");
      return;
    }

    // --- START DUPLICATE DRIVER VALIDATION ---
    const { qualifyingTop3, sprintTop3, raceTop10 } = currentPrediction;

    const hasDuplicates = (arr: (string | null)[] | undefined, fieldName: string): boolean => {
      if (!arr) return false;
      const nonNullDrivers = arr.filter(driverId => driverId !== null);
      if (new Set(nonNullDrivers).size !== nonNullDrivers.length) {
        setSaveError(`Error: Hay pilotos duplicados en tu predicción para ${fieldName}. Por favor, selecciona pilotos diferentes para cada posición.`);
        return true;
      }
      return false;
    };

    if (hasDuplicates(qualifyingTop3, "el Top 3 de Clasificación")) return;
    if (race.isSprintWeekend && hasDuplicates(sprintTop3, "el Top 3 de la Carrera Sprint")) return;
    if (hasDuplicates(raceTop10, "el Top 10 de la Carrera Principal")) return;
    // --- END DUPLICATE DRIVER VALIDATION ---

    setIsSaving(true);
    setSaveSuccess(false);
    setSaveError(null); // Clear previous errors if validation passes

    try {
      await savePrediction(currentPrediction);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error("Error saving prediction:", error);
      setSaveError("No se pudo guardar la predicción. Inténtalo de nuevo.");
    } finally {
      setIsSaving(false);
    }
  };

  // This covers loading static data (like race details) and user-specific prediction data
  if (isLoadingInitial || loadingData || loadingUserGameData && !currentPrediction) {
    return <LoadingSpinner message="Cargando datos de predicción..." />;
  }
  
  if (!race || !currentPrediction) { // Should be covered by above, but good failsafe
    return <LoadingSpinner message="Preparando página de predicción..." />;
  }
  
  const driverOptions = F1_DRIVERS_2025; 

  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8">
      <header className="mb-8 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold text-red-500">Predicciones para {race.name}</h1>
        <p className="text-gray-300 mt-1">Circuito: {race.circuit}</p>
        {isPredictionLocked && (
            <p className="mt-2 text-yellow-400 bg-yellow-900/50 p-3 rounded-md inline-flex items-center">
                <AlertTriangle size={20} className="mr-2" /> Las predicciones para esta carrera están cerradas.
            </p>
        )}
      </header>

      <form onSubmit={handleSubmit} className="bg-gray-800/70 p-6 sm:p-8 rounded-xl shadow-2xl backdrop-blur-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          <PredictionInput
            label="Top 3 Clasificación"
            options={driverOptions}
            value={currentPrediction.qualifyingTop3}
            onChange={(val) => handlePredictionChange('qualifyingTop3', val)}
            maxSelections={3}
            disabled={isPredictionLocked || isSaving}
          />

          {race.isSprintWeekend && (
            <PredictionInput
              label="Top 3 Carrera Sprint"
              options={driverOptions}
              value={currentPrediction.sprintTop3}
              onChange={(val) => handlePredictionChange('sprintTop3', val)}
              maxSelections={3}
              disabled={isPredictionLocked || isSaving}
            />
          )}
        
          <div className="md:col-span-2">
            <PredictionInput
                label="Top 10 Carrera Principal"
                options={driverOptions}
                value={currentPrediction.raceTop10}
                onChange={(val) => handlePredictionChange('raceTop10', val)}
                maxSelections={10}
                disabled={isPredictionLocked || isSaving}
            />
          </div>

          <PredictionInput
            label="Vuelta Rápida"
            options={driverOptions}
            value={currentPrediction.fastestLap}
            onChange={(val) => handlePredictionChange('fastestLap', val)}
            disabled={isPredictionLocked || isSaving}
          />

          <PredictionInput
            label="Piloto del Día"
            options={driverOptions}
            value={currentPrediction.driverOfTheDay}
            onChange={(val) => handlePredictionChange('driverOfTheDay', val)}
            disabled={isPredictionLocked || isSaving}
          />
        </div>

        <div className="mt-10 text-center">
          {saveSuccess && (
            <p className="mb-4 text-green-400 bg-green-900/50 p-3 rounded-md flex items-center justify-center">
              <CheckCircle size={20} className="mr-2"/> ¡Predicción guardada con éxito!
            </p>
          )}
          {saveError && (
             <p className="mb-4 text-red-400 bg-red-900/50 p-3 rounded-md flex items-center justify-center">
                <AlertTriangle size={20} className="mr-2"/> {saveError}
            </p>
          )}
          <button
            type="submit"
            disabled={isSaving || isPredictionLocked}
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 rounded-lg shadow-lg text-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center mx-auto"
          >
            {isSaving ? <LoadingSpinner size="sm" /> : <Save className="mr-2" />}
            {isSaving ? 'Guardando...' : 'Guardar Predicción'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PredictionPage;
