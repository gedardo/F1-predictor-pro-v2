import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { F1Race, AppRoute, Prediction } from '../types';
import { useData } from '../contexts/DataContext';
import { PREDICTION_CLOSE_HOURS_BEFORE, SCORING_RULES } from '../constants';
import Modal from './Modal';
import { Award, UserCheck, BarChartHorizontalBig} from 'lucide-react';

interface RaceCardProps {
  race: F1Race;
}

const RaceCard: React.FC<RaceCardProps> = ({ race }) => {
  const { getDriverById, getPredictionForRace } = useData();
  const [countdown, setCountdown] = useState<string>('');
  const [isPast, setIsPast] = useState<boolean>(false);
  const [isPredictionOpen, setIsPredictionOpen] = useState<boolean>(true);
  const [isResultsModalOpen, setIsResultsModalOpen] = useState(false);
  const [userPredictionForRace, setUserPredictionForRace] = useState<Prediction | undefined>(undefined);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!race.sessions) {
        setCountdown('Horarios no disponibles');
        const raceDateObject = new Date(race.date + "T23:59:59Z"); // Consider full day for past check
        setIsPast(new Date() > raceDateObject);
        setIsPredictionOpen(false);
        return;
    }

    const raceDateTime = new Date(race.sessions.race);
    const now = new Date();
    
    setIsPast(now > raceDateTime);

    const predictionDeadline = new Date(race.sessions.qualifying); 
    predictionDeadline.setHours(predictionDeadline.getHours() - PREDICTION_CLOSE_HOURS_BEFORE);
    setIsPredictionOpen(now < predictionDeadline && now < raceDateTime);

    if (now < raceDateTime) {
      const intervalId = setInterval(() => {
        const currentNow = new Date();
        const diff = raceDateTime.getTime() - currentNow.getTime();

        if (diff <= 0) {
          setCountdown('¡Carrera en curso o finalizada!');
          clearInterval(intervalId);
          setIsPast(true);
          return;
        }

        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);
        setCountdown(`${d}d ${h}h ${m}m ${s}s`);
      }, 1000);
      return () => clearInterval(intervalId);
    } else {
      setCountdown('Carrera Finalizada');
    }
  }, [race.sessions, race.date]);

  useEffect(() => {
    if (isResultsModalOpen) {
      const prediction = getPredictionForRace(race.id);
      setUserPredictionForRace(prediction);
    }
  }, [isResultsModalOpen, race.id, getPredictionForRace]);

  const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  const formatTime = (dateString: string) => new Date(dateString).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  const hasActualResults = race.raceTop10Real && race.raceTop10Real.some(p => p !== null);

  const getSafeDriverName = (driverId: string | null | undefined): string => {
    if (!driverId) return 'N/A';
    return getDriverById(driverId)?.name || `ID: ${driverId.substring(0,6)}`;
  };

  const getPointsForPrediction = (
    type: 'pole' | 'fastestLap' | 'driverOfTheDay' | 'raceTop10',
    predictedDriverId: string | null | undefined,
    actualDriverId: string | null | undefined,
    actualTop10?: (string | null)[] | null,
    predictedPositionIndex?: number // 0-9 for Top10
  ): number => {
    if (!predictedDriverId) return 0;

    const rules = {
      pole: SCORING_RULES.find(r => r.action === 'Pole Position (Clasificación)')?.points || 0,
      fastestLap: SCORING_RULES.find(r => r.action === 'Vuelta Rápida (Carrera)')?.points || 0,
      driverOfTheDay: SCORING_RULES.find(r => r.action === 'Piloto del Día (Carrera)')?.points || 0,
      podiumExact: SCORING_RULES.find(r => r.action === 'Piloto en Podio (Posición Exacta - Carrera)')?.points || 0,
      podiumIncorrect: SCORING_RULES.find(r => r.action === 'Piloto en Podio (Posición Incorrecta - Carrera)')?.points || 0,
      top10Exact: SCORING_RULES.find(r => r.action === 'Piloto en Top 10 (Posición Exacta - Carrera)')?.points || 0,
      top10Incorrect: SCORING_RULES.find(r => r.action === 'Piloto en Top 10 (Posición Incorrecta dentro del Top 10 - Carrera)')?.points || 0,
    };

    if (type === 'pole' || type === 'fastestLap' || type === 'driverOfTheDay') {
      return predictedDriverId === actualDriverId ? rules[type] : 0;
    }

    if (type === 'raceTop10' && actualTop10 && predictedPositionIndex !== undefined) {
      const actualDriverInPredictedPosition = actualTop10[predictedPositionIndex];
      const isPredictedDriverInActualTop10 = actualTop10.includes(predictedDriverId);

      if (predictedDriverId === actualDriverInPredictedPosition) { // Exact match
        return predictedPositionIndex < 3 ? rules.podiumExact : rules.top10Exact;
      } else if (isPredictedDriverInActualTop10) { // Predicted driver is in Top 10, but wrong spot
        const actualIndexOfPredictedDriver = actualTop10.indexOf(predictedDriverId);
        if (predictedPositionIndex < 3 && actualIndexOfPredictedDriver < 3) { // User predicted podium, driver was on podium (wrong spot)
          return rules.podiumIncorrect;
        }
        // User predicted podium, driver was P4-10 OR user predicted P4-10, driver was somewhere in Top 10
        return rules.top10Incorrect;
      }
    }
    return 0;
  };

  const PointsBadge: React.FC<{ points: number }> = ({ points }) => (
    <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold
      ${points > 0 ? 'bg-yellow-500 text-yellow-900' : 'bg-gray-600 text-gray-300'}`}>
      {points} pts
    </span>
  );


  return (
    <div className={`bg-gray-800 p-5 rounded-lg shadow-lg transition-all duration-300 hover:shadow-red-500/30 border-l-4 ${isPast ? (hasActualResults ? 'border-green-500' : 'border-gray-600 opacity-80') : 'border-red-500'}`}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3">
        <div>
        </div>
        {race.mapUrl && (
          <>
            <img
              src={race.mapUrl}
              alt={`Mapa de ${race.circuit}`}
              className="w-82 h-60 object-contain rounded-md mt-2 sm:mt-0 cursor-pointer hover:scale-105 transition-transform"
              onClick={() => setShowModal(true)}
            />
            {showModal && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80"
                onClick={() => setShowModal(false)}
              >
                <div
                  className="relative"
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    className="absolute top-2 right-2 text-white text-2xl font-bold bg-black bg-opacity-50 rounded-full px-2 hover:bg-opacity-80 transition-colors"
                    onClick={() => setShowModal(false)}
                    aria-label="Cerrar"
                  >
                    ×
                  </button>
                  <img
                    src={race.mapUrl}
                    alt={`Mapa de ${race.circuit}`}
                    className="max-w-[90vw] max-h-[80vh] rounded-lg shadow-2xl border-4 border-yellow-400"
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

          <h3 className="text-2xl font-bold text-red-500">{race.name}</h3>
          <p className="text-sm text-gray-400">{race.circuit}, {race.country}</p>
          <p className="text-sm text-gray-300 font-semibold">Ronda {race.round} - {formatDate(race.date)}</p>
      
      {!isPast && race.sessions && (
        <div className="mb-4 p-3 bg-gray-700 rounded-md">
          <p className="text-center text-lg font-semibold text-yellow-400">Próxima Carrera: {countdown}</p>
        </div>
      )}

      {isPast && hasActualResults ? (
        <div className="mt-3">
          {race.raceTop10Real && race.raceTop10Real[0] && (
            <p className="text-md font-semibold text-yellow-400 mb-1 flex items-center">
              <Award size={20} className="mr-2 text-yellow-500" /> Ganador: {getSafeDriverName(race.raceTop10Real[0])}
            </p>
          )}
          {race.raceTop10Real && race.raceTop10Real.length >= 3 && race.raceTop10Real.slice(0,3).every(p => p !== null) && (
            <>
              <h4 className="text-md font-semibold text-gray-200 mt-2 mb-1">Podio Real:</h4>
              <ul className="list-none text-sm text-gray-300 pl-1 space-y-1">
                <li className="flex items-center"><span className="text-lg mr-1.5">🥇</span> {getSafeDriverName(race.raceTop10Real[0])}</li>
                <li className="flex items-center"><span className="text-lg mr-1.5">🥈</span> {getSafeDriverName(race.raceTop10Real[1])}</li>
                <li className="flex items-center"><span className="text-lg mr-1.5">🥉</span> {getSafeDriverName(race.raceTop10Real[2])}</li>
              </ul>
            </>
          )}
        </div>
      ) : (!isPast && race.mockPodium) ? (
        <div className="mt-3">
          <h4 className="text-md font-semibold text-gray-200 mb-1">Podio Simulado:</h4>
          <ul className="list-none text-sm text-gray-300 pl-1 space-y-1">
            <li className="flex items-center"><span className="text-lg mr-1.5">🥇</span> {getSafeDriverName(race.mockPodium.first)}</li>
            <li className="flex items-center"><span className="text-lg mr-1.5">🥈</span> {getSafeDriverName(race.mockPodium.second)}</li>
            <li className="flex items-center"><span className="text-lg mr-1.5">🥉</span> {getSafeDriverName(race.mockPodium.third)}</li>
          </ul>
        </div>
      ) : null}
      
      {race.sessions && (
        <div className="mt-4 text-xs text-gray-400 space-y-1">
            <p>Clasificación: {formatDate(race.sessions.qualifying)} - {formatTime(race.sessions.qualifying)}</p>
            {race.isSprintWeekend && race.sessions.sprint && <p>Carrera Sprint: {formatDate(race.sessions.sprint)} - {formatTime(race.sessions.sprint)}</p>}
            <p>Carrera Principal: {formatDate(race.sessions.race)} - {formatTime(race.sessions.race)}</p>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        {isPast && hasActualResults ? (
            <button
              onClick={() => setIsResultsModalOpen(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200 shadow-md hover:shadow-lg"
            >
              Ver Resultados
            </button>
        ) : isPredictionOpen && !isPast && race.sessions ? (
          <Link 
            to={`${AppRoute.Prediction}/${race.id}`} 
            className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200 shadow-md hover:shadow-lg"
          >
            Hacer Predicción
          </Link>
        ) : (
          <span className={`py-2 px-4 rounded-lg text-sm ${isPast ? 'bg-gray-700 text-gray-400' : 'bg-yellow-600 text-yellow-100'}`}>
             {isPast ? 'Resultados Pendientes' : (race.sessions ? 'Predicciones Cerradas' : 'Horarios No Disponibles')}
          </span>
        )}
      </div>

      <Modal
        isOpen={isResultsModalOpen}
        onClose={() => setIsResultsModalOpen(false)}
        title={`Resultados y Tu Predicción: ${race.name}`}
        size="3xl" 
      >
        <div className="text-gray-300 max-h-[70vh] overflow-y-auto custom-scrollbar pr-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            {/* Columna de Resultados Reales */}
            <section>
              <h3 className="text-xl font-semibold text-red-400 mb-3 pb-2 border-b border-gray-700 flex items-center">
                <BarChartHorizontalBig size={22} className="mr-2"/> Resultados Reales
              </h3>
              <div className="space-y-3 text-sm">
                {race.polePositionRealPilotId && (
                  <p><strong>Pole Position:</strong> {getSafeDriverName(race.polePositionRealPilotId)}</p>
                )}
                {race.raceTop10Real && race.raceTop10Real.some(p => p !== null) && (
                  <div>
                    <h4 className="font-semibold text-gray-200 mb-1">Top 10 Carrera:</h4>
                    <ol className="list-decimal list-inside space-y-1">
                      {race.raceTop10Real.map((pilotId, index) => (
                        pilotId && <li key={`real-${index}`}><strong>{index + 1}.</strong> {getSafeDriverName(pilotId)}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {race.fastestLapRealPilotId && (
                  <p><strong>Vuelta Rápida:</strong> {getSafeDriverName(race.fastestLapRealPilotId)}</p>
                )}
                {race.driverOfTheDayRealPilotId && (
                  <p><strong>Piloto del Día:</strong> {getSafeDriverName(race.driverOfTheDayRealPilotId)}</p>
                )}
                {!hasActualResults && (
                    <p>Resultados detallados aún no disponibles para esta carrera.</p>
                )}
              </div>
            </section>

            {/* Columna de Predicciones del Usuario */}
            <section>
              <h3 className="text-xl font-semibold text-blue-400 mb-3 pb-2 border-b border-gray-700 flex items-center">
                <UserCheck size={22} className="mr-2"/> Tu Predicción
              </h3>
              {userPredictionForRace ? (
                <div className="space-y-3 text-sm">
                  <div>
                    <strong>Pole Position:</strong> {getSafeDriverName(userPredictionForRace.qualifyingTop3?.[0])}
                    <PointsBadge points={getPointsForPrediction('pole', userPredictionForRace.qualifyingTop3?.[0], race.polePositionRealPilotId)} />
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-200 mb-1 mt-2">Top 10 Carrera:</h4>
                    <ol className="list-decimal list-inside space-y-1">
                      {userPredictionForRace.raceTop10.map((predictedPilotId, index) => (
                         <li key={`pred-${index}`}>
                           <strong>{index + 1}.</strong> {getSafeDriverName(predictedPilotId)}
                           <PointsBadge points={getPointsForPrediction('raceTop10', predictedPilotId, null, race.raceTop10Real, index)} />
                         </li>
                      ))}
                    </ol>
                  </div>
                  <div className="mt-2">
                    <strong>Vuelta Rápida:</strong> {getSafeDriverName(userPredictionForRace.fastestLap)}
                    <PointsBadge points={getPointsForPrediction('fastestLap', userPredictionForRace.fastestLap, race.fastestLapRealPilotId)} />
                  </div>
                  <div>
                    <strong>Piloto del Día:</strong> {getSafeDriverName(userPredictionForRace.driverOfTheDay)}
                    <PointsBadge points={getPointsForPrediction('driverOfTheDay', userPredictionForRace.driverOfTheDay, race.driverOfTheDayRealPilotId)} />
                  </div>
                </div>
              ) : (
                <p className="text-gray-400 italic">No realizaste predicciones para esta carrera.</p>
              )}
            </section>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default RaceCard;
