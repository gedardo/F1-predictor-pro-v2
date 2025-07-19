import React from 'react';
import { useData } from '../contexts/DataContext';
import LoadingSpinner from '../components/LoadingSpinner';
import { Trophy, Users } from 'lucide-react';

const StandingsPage: React.FC = () => {
  const { driverStandings, constructorStandings, getDriverById, getTeamById, drivers, teams, loadingData } = useData();

  if (loadingData && (!driverStandings.length || !constructorStandings.length)) {
    return <LoadingSpinner message="Cargando clasificaciones..." />;
  }
  
  const fullDriverStandings = driverStandings.map(ds => {
    // Buscar el piloto en la base de datos usando el driverId mapeado
    const driver = drivers.find(d => d.id === ds.driverId) || getDriverById(ds.driverId);
    // Usar el teamId del standing si está disponible, o el del piloto como respaldo
    const teamId = (ds as any).teamId || driver?.teamId;
    // Buscar el equipo en la base de datos usando el teamId mapeado
    const team = teams.find(t => t.id === teamId) || getTeamById(teamId);
    return {
      ...ds,
      driverName: driver?.name || ds.driverId || 'N/A',
      driverNumber: driver?.number,
      teamName: team?.name || teamId || 'N/A',
      teamColor: team?.color || 'bg-gray-500',
      headshotUrl: driver?.headshotUrl,
    };
  });

  const fullConstructorStandings = constructorStandings.map(cs => {
    // Buscar el equipo en la base de datos usando el teamId mapeado
    const team = teams.find(t => t.id === cs.teamId) || getTeamById(cs.teamId);
    return {
      ...cs,
      teamName: team?.name || cs.teamId || 'N/A',
      teamColor: team?.color || 'bg-gray-500',
      teamLogo: team?.logoUrl,
    };
  });


  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-red-500">Clasificaciones Oficiales F1 2025</h1>
        <p className="text-gray-300 mt-1">Datos actualizados después de cada Gran Premio.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Driver Standings */}
        <section className="bg-gray-800 p-6 rounded-lg shadow-xl">
          <h2 className="text-2xl font-semibold text-red-400 mb-6 flex items-center"><Users className="mr-3 text-red-500" size={28}/>Clasificación de Pilotos</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="p-3 text-sm font-semibold text-gray-400">Pos.</th>
                  <th className="p-3 text-sm font-semibold text-gray-400">Piloto</th>
                  <th className="p-3 text-sm font-semibold text-gray-400">Equipo</th>
                  <th className="p-3 text-sm font-semibold text-gray-400 text-right">Puntos</th>
                </tr>
              </thead>
              <tbody>
                {fullDriverStandings.map((standing) => (
                  <tr key={standing.driverId} className="border-b border-gray-700/50 hover:bg-gray-700/50 transition-colors">
                    <td className="p-3 font-medium text-gray-200">{standing.position}</td>
                    <td className="p-3">
                      <div className="flex items-center">
                         {standing.headshotUrl && 
                            <img src={standing.headshotUrl} alt={standing.driverName} className="w-8 h-8 rounded-full mr-3 object-cover" />
                         }
                        <div>
                            <span className="font-medium text-white">{standing.driverName}</span>
                            {standing.driverNumber && <span className="ml-1 text-xs text-gray-400">#{standing.driverNumber}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                        <span className={`px-2 py-0.5 text-xs rounded-full ${standing.teamColor.replace('bg-', 'text-').replace('-500', '-300')} ${standing.teamColor.replace('text-', 'bg-').replace('-300', '-800') } bg-opacity-50`}>
                            {standing.teamName}
                        </span>
                    </td>
                    <td className="p-3 font-bold text-yellow-400 text-right">{standing.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Constructor Standings */}
        <section className="bg-gray-800 p-6 rounded-lg shadow-xl">
          <h2 className="text-2xl font-semibold text-red-400 mb-6 flex items-center"><Trophy className="mr-3 text-red-500" size={28}/>Clasificación de Escuderías</h2>
           <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="p-3 text-sm font-semibold text-gray-400">Pos.</th>
                  <th className="p-3 text-sm font-semibold text-gray-400">Escudería</th>
                  <th className="p-3 text-sm font-semibold text-gray-400 text-right">Puntos</th>
                </tr>
              </thead>
              <tbody>
                {fullConstructorStandings.map((standing) => (
                  <tr key={standing.teamId} className="border-b border-gray-700/50 hover:bg-gray-700/50 transition-colors">
                    <td className="p-3 font-medium text-gray-200">{standing.position}</td>
                    <td className="p-3">
                      <div className="flex items-center">
                        {standing.teamLogo && <img src={standing.teamLogo} alt={standing.teamName} className={`w-8 h-8 mr-3 object-contain p-0.5 rounded ${standing.teamColor}`}/>} 
                        <span className={`font-medium text-white`}>{standing.teamName}</span>
                      </div>
                    </td>
                    <td className="p-3 font-bold text-yellow-400 text-right">{standing.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};

export default StandingsPage;
    