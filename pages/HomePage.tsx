
import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import DashboardCard from '../components/DashboardCard';
import LeaderboardItem from '../components/LeaderboardItem';
import NewsItem from '../components/NewsItem';
import LoadingSpinner from '../components/LoadingSpinner';
import { F1Race, AppRoute } from '../types'; // Removed UserRanking, UserProfileBasic as they are inferred
import { Users, BarChart2, CalendarDays, ListChecks, Newspaper, Award, Edit3, Puzzle, UserCheck, Settings2 } from 'lucide-react'; 

const HomePage: React.FC = () => {
  const { currentUser } = useAuth();
  const { 
    news, loadingData, races, fetchNews, 
    userRankings, getUserRankInfo, getLatestUserScoreEvent, getUserProfileById,
    loadingUserGameData 
  } = useData();

  useEffect(() => {
    // Fetch news only once on component mount if not already fetched or stale
    if (news.length === 0) {
      fetchNews();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const upcomingRaces = races
    .filter(race => race.sessions && new Date(race.sessions.race) > new Date())
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  const nextRace: F1Race | undefined = upcomingRaces[0];

  const currentUserRankInfo = currentUser ? getUserRankInfo(currentUser.id) : undefined;
  const currentUserTotalPoints = currentUserRankInfo?.total_overall_score ?? 0;
  const latestScoreEvent = currentUser ? getLatestUserScoreEvent(currentUser.id) : undefined;
  const lastEventPoints = latestScoreEvent?.event_total_score ?? 0;

  const displayLeaderboard = userRankings
    .map(rank => {
      const userProfile = getUserProfileById(rank.user_id);
      return {
        id: rank.user_id,
        name: userProfile?.nickname || `Usuario ${rank.user_id.substring(0,6)}`, // Use nickname
        avatarUrl: userProfile?.avatarUrl,
        points: rank.total_overall_score,
        rank: rank.rank,
        isCurrentUser: currentUser?.id === rank.user_id,
      };
    })
    .sort((a,b) => a.rank - b.rank) 
    .slice(0, 10); 


  if (loadingData && !currentUser && news.length === 0 && races.length === 0) { 
      return <div className="flex justify-center items-center min-h-[calc(100vh-10rem)]"><LoadingSpinner message="Cargando dashboard..." /></div>;
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8">
      <header className="mb-8 p-6 bg-gradient-to-r from-red-600 to-red-800 rounded-lg shadow-xl text-white">
        <h1 className="text-3xl sm:text-4xl font-bold">
          ¡Bienvenido, {currentUser?.nickname || 'Piloto'}! {/* Use nickname */}
        </h1>
        <p className="text-lg mt-1">Listo para la próxima carrera? Tus predicciones te esperan.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <DashboardCard title="Mi Puntuación General" icon={<Award />}>
          {loadingUserGameData && !currentUserRankInfo ? <LoadingSpinner size="sm"/> :
            <>
              <p className="text-3xl font-bold text-yellow-400">{currentUserTotalPoints} <span className="text-lg text-gray-300">pts</span></p>
              <p className="text-sm text-gray-400">Último evento: {lastEventPoints} pts</p>
              {currentUserRankInfo && <p className="text-sm text-gray-400 mt-1">Ranking Global: #{currentUserRankInfo.rank}</p>}
               {!currentUserRankInfo && currentUser && !loadingUserGameData && <p className="text-sm text-gray-400 mt-1">Aún no tienes un ranking.</p>}
            </>
          }
        </DashboardCard>

        {nextRace && nextRace.sessions ? (
          <DashboardCard title="Próximo Evento" icon={<CalendarDays />}>
            <h4 className="text-lg font-semibold text-gray-200">{nextRace.name}</h4>
            <p className="text-sm text-gray-400">{new Date(nextRace.date).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            <Link 
              to={`${AppRoute.Prediction}/${nextRace.id}`} 
              className="mt-3 inline-block bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-semibold py-2 px-4 rounded-md transition-colors text-sm"
            >
              Ir a Predecir
            </Link>
          </DashboardCard>
        ): (
           <DashboardCard title="Próximo Evento" icon={<CalendarDays />}>
             <p className="text-gray-400">No hay próximos eventos programados o datos de sesiones no disponibles.</p>
           </DashboardCard>
        )}

        <DashboardCard title="Noticias F1" icon={<Newspaper />}>
          {loadingData && news.length === 0 ? <LoadingSpinner size="sm" /> : (
            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
              {news.length > 0 ? news.slice(0,3).map((item, index) => (
                <NewsItem key={index} article={item} />
              )) : <p className="text-gray-400 text-sm">No hay noticias disponibles.</p>}
            </div>
          )}
        </DashboardCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <DashboardCard title="Ranking de Jugadores" icon={<Users />}>
            {loadingUserGameData && displayLeaderboard.length === 0 && userRankings.length === 0 ? <LoadingSpinner message="Cargando ranking..." /> :
            displayLeaderboard.length > 0 ? (
              <ul className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
                {displayLeaderboard.map((userEntry) => (
                  <LeaderboardItem 
                    key={userEntry.id} 
                    rank={userEntry.rank} 
                    name={userEntry.name} // Already using nickname via getUserProfileById
                    points={userEntry.points} 
                    isCurrentUser={userEntry.isCurrentUser}
                    avatarUrl={userEntry.avatarUrl}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-gray-400">Aún no hay datos en el ranking. ¡Participa para aparecer aquí!</p>
            )}
            {userRankings.length > 10 && <p className="text-xs text-gray-500 mt-3 text-center">Mostrando Top 10. ¡Sigue sumando puntos!</p>}
          </DashboardCard>
        </div>

        <div className="space-y-6">
           <DashboardCard title="Enlaces Rápidos" icon={<ListChecks />}>
            <ul className="space-y-2">
              {nextRace && nextRace.sessions && (
                <li>
                  <Link 
                    to={`${AppRoute.Prediction}/${nextRace.id}`} 
                    className="flex items-center p-2 bg-gray-700 hover:bg-red-600 rounded-md transition-colors text-gray-200 hover:text-white"
                  >
                    <Edit3 size={18} className="mr-2 text-yellow-400"/> Predecir Próxima Carrera
                  </Link>
                </li>
              )}
               <li>
                  <Link 
                    to={AppRoute.DriverGuessGame}
                    className="flex items-center p-2 bg-gray-700 hover:bg-red-600 rounded-md transition-colors text-gray-200 hover:text-white"
                  >
                    <Puzzle size={18} className="mr-2 text-yellow-400"/> Adivina el Piloto
                  </Link>
                </li>
              <li><Link to={AppRoute.MyTeam} className="flex items-center p-2 bg-gray-700 hover:bg-red-600 rounded-md transition-colors text-gray-200 hover:text-white"><UserCheck size={18} className="mr-2 text-blue-400"/>Gestionar Mi Equipo F1</Link></li>
              <li><Link to={AppRoute.Standings} className="flex items-center p-2 bg-gray-700 hover:bg-red-600 rounded-md transition-colors text-gray-200 hover:text-white"><BarChart2 size={18} className="mr-2 text-green-400"/>Ver Clasificaciones Oficiales</Link></li>
              <li><Link to={AppRoute.Calendar} className="flex items-center p-2 bg-gray-700 hover:bg-red-600 rounded-md transition-colors text-gray-200 hover:text-white"><CalendarDays size={18} className="mr-2 text-purple-400"/>Consultar Calendario</Link></li>
               <li><Link to={AppRoute.Rules} className="flex items-center p-2 bg-gray-700 hover:bg-red-600 rounded-md transition-colors text-gray-200 hover:text-white"><Settings2 size={18} className="mr-2 text-gray-400" />Reglas del Juego</Link></li>
                 {/* Placeholder for Admin Link. Actual admin role check needed. */}
                {currentUser?.email?.endsWith('@admin.example.com') && ( // Simple pseudo-admin check
                    <li><Link to={AppRoute.AdminRaceResults} className="flex items-center p-2 bg-gray-700 hover:bg-red-600 rounded-md transition-colors text-gray-200 hover:text-white">Cargar Resultados (Admin)</Link></li>
                )}
            </ul>
          </DashboardCard>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
