
import React from 'react';
import { useData } from '../contexts/DataContext';
import RaceCard from '../components/RaceCard';
import LoadingSpinner from '../components/LoadingSpinner';
import { CalendarHeart } from 'lucide-react';

const CalendarPage: React.FC = () => {
  const { races, loadingData } = useData();

  if (loadingData && races.length === 0) {
    return <LoadingSpinner message="Cargando calendario..." />;
  }

  const sortedRaces = [...races].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-red-500 flex items-center justify-center">
            <CalendarHeart size={40} className="mr-3 text-red-600" />
            Calendario F1 2025
        </h1>
        <p className="text-gray-300 mt-1">Planifica tus fines de semana de carreras.</p>
      </header>

      {races.length === 0 && !loadingData ? (
        <p className="text-center text-gray-400 text-xl">El calendario de carreras no está disponible actualmente.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {sortedRaces.map(race => (
            <RaceCard key={race.id} race={race} />
          ))}
        </div>
      )}
    </div>
  );
};

export default CalendarPage;
    