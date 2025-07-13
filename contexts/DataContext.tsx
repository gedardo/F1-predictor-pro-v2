import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { 
  F1Team, F1Driver, F1Race, Prediction, UserF1Team, 
  DriverStanding, ConstructorStanding, NewsArticle, RaceSession,
  UserScore, UserRanking, UserProfileBasic} from '../types';
import { MOCK_DRIVER_STANDINGS, MOCK_CONSTRUCTOR_STANDINGS, DEFAULT_USER_F1_TEAM } from '../constants';
import { getF1News } from '../services/geminiService';
import { useAuth } from './AuthContext';
import { useLogger } from './LoggingContext';
import f1Api from 'f1-api-node';

interface DataContextType {
  teams: F1Team[];
  drivers: F1Driver[];
  races: F1Race[];
  driverStandings: DriverStanding[]; 
  constructorStandings: ConstructorStanding[];
  userF1Team: UserF1Team;
  predictions: Prediction[];
  news: NewsArticle[];
  userRankings: UserRanking[]; 
  rankedUserProfiles: UserProfileBasic[]; 
  currentUserScores: UserScore[]; 

  loadingData: boolean; 
  loadingUserGameData: boolean; 
  getRaceById: (raceId: string) => F1Race | undefined;
  getDriverById: (driverId: string) => F1Driver | undefined;
  getTeamById: (teamId: string) => F1Team | undefined;
  updateUserF1Team: (team: UserF1Team) => Promise<void>;
  savePrediction: (prediction: Prediction) => Promise<void>;
  getPredictionForRace: (raceId: string) => Prediction | undefined;
  fetchNews: () => Promise<void>;
  resetUserGameData: () => Promise<void>;

  recordGuessGameScore: (userId: string, points: number, eventDate: string) => Promise<void>;
  updateUserGuessGameStats: (userId: string, playsToday: number, winsToday: number, lastPlayDate: string) => Promise<void>;

  getUserRankInfo: (userId: string) => UserRanking | undefined;
  getLatestUserScoreEvent: (userId: string) => UserScore | undefined;
  getUserProfileById: (userId: string) => UserProfileBasic | undefined;
  
  updateRaceResults: (raceId: string, results: Partial<Pick<F1Race, 'polePositionRealPilotId' | 'raceTop10Real' | 'fastestLapRealPilotId' | 'driverOfTheDayRealPilotId'>>) => Promise<void>;
  triggerScoreCalculation: (raceId: string) => Promise<any>; 
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { currentUser, fetchUserProfile: authFetchUserProfile, updateCurrentLocalUser } = useAuth(); 
  const { addLog } = useLogger();

  const [teams, setTeams] = useState<F1Team[]>([]);
  const [drivers, setDrivers] = useState<F1Driver[]>([]);
  const [races, setRaces] = useState<F1Race[]>([]);
  
  const [driverStandings, setDriverStandings] = useState<DriverStanding[]>(MOCK_DRIVER_STANDINGS);
  const [constructorStandings, setConstructorStandings] = useState<ConstructorStanding[]>(MOCK_CONSTRUCTOR_STANDINGS);
  
  const [userF1Team, setUserF1Team] = useState<UserF1Team>(DEFAULT_USER_F1_TEAM);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [loadingData, setLoadingData] = useState<boolean>(true);
  const [loadingUserGameData, setLoadingUserGameData] = useState<boolean>(false);

  const [userRankings, setUserRankings] = useState<UserRanking[]>([]);
  const [rankedUserProfiles, setRankedUserProfiles] = useState<UserProfileBasic[]>([]);
  const [currentUserScores, setCurrentUserScores] = useState<UserScore[]>([]);


  const fetchF1Data = useCallback(async () => {
    setLoadingData(true);
    const startTime = Date.now();
    try {
      const { data: teamsData, error: teamsError } = await supabase.from('f1_equipos_predeterminados').select('*');
      if (teamsError) throw teamsError;
      setTeams(teamsData.map(t => ({ id: t.id_equipo_pred, name: t.nombre, color: t.color, logoUrl: t.logo_url })));

      const { data: driversData, error: driversError } = await supabase.from('f1_pilotos_predeterminados').select('*');
      if (driversError) throw driversError;
      setDrivers(driversData.map(d => ({ id: d.id_piloto_pred, name: d.nombre, teamId: d.id_equipo_pred, number: d.numero_piloto, nationality: d.nacionalidad, headshotUrl: d.url_foto })));

      const { data: racesData, error: racesError } = await supabase.from('f1_carreras_predeterminadas').select('*');
      if (racesError) throw racesError;
      setRaces(racesData.map(r => ({
        id: r.id_carrera_pred,
        name: r.nombre,
        circuit: r.circuito,
        country: r.pais,
        date: r.fecha_carrera,
        sessions: r.sesiones as RaceSession | null, 
        isSprintWeekend: r.es_sprint,
        round: r.ronda,
        mapUrl: r.url_mapa_circuito,
        laps: r.vueltas,
        length: r.longitud_km,
        polePositionRealPilotId: r.pole_position_real_piloto_id,
        raceTop10Real: r.race_top_10_real as (string | null)[] | null,
        fastestLapRealPilotId: r.vuelta_rapida_real_piloto_id,
        driverOfTheDayRealPilotId: r.piloto_del_dia_real_piloto_id,
        // mockPodium will be sourced from constants.ts if needed by RaceCard logic
      })));
      addLog({ table: 'f1_equipos, f1_pilotos, f1_carreras', operation: 'SELECT', status: 'success', summary: 'Fetched all F1 predefined data', startTime });
    } catch (error: any) {
      console.error("Error fetching F1 data from Supabase:", error);
      addLog({ table: 'f1_data', operation: 'SELECT', status: 'error', summary: 'Failed to fetch F1 predefined data', error: error.message || String(error), startTime });
    } finally {
      setLoadingData(false);
    }
  }, [addLog]);

  const fetchNews = useCallback(async () => {
    const fetchedNews = await getF1News(); 
    setNews(fetchedNews);
  }, []);
  
  const fetchStandingsFromApi = useCallback(async () => {
    setLoadingData(true);
    try {
      // Pilotos
      const driverData = await f1Api.getDriverStandings(2025);
      setDriverStandings(driverData.map((d: any) => {
        // Extraer driverId de la sigla final del string 'driver', por ejemplo: ' Oscar PiastriPIA' => 'pia'
        let driverId = '';
        if (d.driver && typeof d.driver === 'string') {
          const match = d.driver.match(/[A-Z]{3}$/);
          driverId = match ? match[0].toLowerCase() : d.driver.replace(/\s/g, '').toLowerCase();
        }
        // teamId: usar el nombre del equipo en minúsculas y sin espacios
        let teamId = '';
        if (d.team && typeof d.team === 'string') {
          teamId = d.team.replace(/\s/g, '').toLowerCase();
        }
        return {
          driverId,
          position: d.position,
          points: d.points,
          teamId,
        };
      }));

      // Escuderías
      const constructorData = await f1Api.getConstructorStandings(2025);
      setConstructorStandings(constructorData.map((c: any) => {
        // teamId: usar el nombre del equipo en minúsculas y sin espacios
        let teamId = '';
        if (c.team && typeof c.team === 'string') {
          teamId = c.team.replace(/\s/g, '').toLowerCase();
        } else if (c.constructorId) {
          teamId = c.constructorId;
        }
        return {
          teamId,
          position: c.position,
          points: c.points,
        };
      }));
    } catch (error: any) {
      console.error('Error al obtener standings desde la API externa:', error);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    fetchF1Data();
    fetchNews();
    fetchStandingsFromApi();
  }, [fetchF1Data, fetchNews, fetchStandingsFromApi]);

  const fetchUserRankingsAndProfiles = useCallback(async () => {
    const rankStartTime = Date.now();
    try {
      const { data: rankingsData, error: rankingsError } = await supabase
        .from('user_rankings') 
        .select('user_id, total_overall_score, rank')
        .order('rank', { ascending: true });

      if (rankingsError) throw new Error(rankingsError.message || 'Failed to fetch user rankings');
      setUserRankings(rankingsData as UserRanking[]);
      addLog({ table: 'user_rankings', operation: 'SELECT', status: 'success', summary: 'Fetched user rankings', startTime: rankStartTime });
      
      if (rankingsData && rankingsData.length > 0) {
        const userIds = rankingsData.map(r => r.user_id);
        const profileStartTime = Date.now();
        const { data: profilesData, error: profilesError } = await supabase
          .from('perfiles_usuarios')
          .select('id, nickname, avatar_url') 
          .in('id', userIds);
        
        if (profilesError) throw new Error(profilesError.message || 'Failed to fetch ranked user profiles');
        setRankedUserProfiles(profilesData.map(p => ({ id: p.id, nickname: p.nickname, avatarUrl: p.avatar_url })));
        addLog({ table: 'perfiles_usuarios', operation: 'SELECT', status: 'success', summary: `Fetched profiles for ${userIds.length} ranked users`, startTime: profileStartTime });
      } else {
        setRankedUserProfiles([]);
      }

    } catch (error: any) {
      console.error("Error fetching user rankings or profiles:", error);
      addLog({ table: 'user_rankings/perfiles_usuarios', operation: 'SELECT', status: 'error', summary: 'Failed to fetch rankings/profiles', error: error.message || String(error), startTime: rankStartTime });
      setUserRankings([]);
      setRankedUserProfiles([]);
    }
  }, [addLog]);

  const fetchCurrentUserScores = useCallback(async (userId: string) => {
    const scoreStartTime = Date.now();
    try {
      const { data: scoresData, error: scoresError } = await supabase
        .from('user_scores')
        .select('*')
        .eq('user_id', userId)
        .order('event_date', { ascending: false });

      if (scoresError) throw new Error(scoresError.message || `Failed to fetch scores for user ${userId}`);
      setCurrentUserScores(scoresData as UserScore[]);
      addLog({ table: 'user_scores', operation: 'SELECT', status: 'success', summary: `Fetched scores for user ${userId}`, startTime: scoreStartTime });
    } catch (error: any) {
      console.error("Error fetching current user scores:", error);
      addLog({ table: 'user_scores', operation: 'SELECT', status: 'error', summary: `Failed to fetch scores for ${userId}`, error: error.message || String(error), startTime: scoreStartTime });
      setCurrentUserScores([]);
    }
  }, [addLog]);


  useEffect(() => {
    fetchUserRankingsAndProfiles();

    const loadUserGameData = async () => {
      if (currentUser) {
        setLoadingUserGameData(true);
        const userStartTime = Date.now();
        try {
          await fetchCurrentUserScores(currentUser.id);

          const { data: teamData, error: teamError } = await supabase
            .from('usuarios_f1_equipos_seleccion')
            .select('pilotos_seleccionados, constructores_seleccionados, cambios_restantes')
            .eq('id_usuario', currentUser.id)
            .maybeSingle();

          if (teamError) throw new Error(teamError.message || 'Failed to fetch user F1 team');
          
          if (teamData) {
            setUserF1Team({
              drivers: teamData.pilotos_seleccionados,
              constructors: teamData.constructores_seleccionados,
              changesRemaining: teamData.cambios_restantes,
            });
            addLog({ table: 'usuarios_f1_equipos_seleccion', operation: 'SELECT', status: 'success', summary: `Fetched user F1 team for ${currentUser.id}`, startTime: userStartTime });
          } else {
            const defaultSupabaseTeam = {
              id_usuario: currentUser.id,
              pilotos_seleccionados: DEFAULT_USER_F1_TEAM.drivers,
              constructores_seleccionados: DEFAULT_USER_F1_TEAM.constructors,
              cambios_restantes: DEFAULT_USER_F1_TEAM.changesRemaining,
            };
            const { error: insertError } = await supabase.from('usuarios_f1_equipos_seleccion').insert(defaultSupabaseTeam);
            if (insertError) throw new Error(insertError.message || 'Failed to insert default F1 team');
            setUserF1Team(DEFAULT_USER_F1_TEAM);
            addLog({ table: 'usuarios_f1_equipos_seleccion', operation: 'INSERT', status: 'success', summary: `Inserted default F1 team for ${currentUser.id}`, startTime: userStartTime });
          }

          const { data: predictionsData, error: predictionsError } = await supabase
            .from('usuarios_predicciones')
            .select('*')
            .eq('id_usuario', currentUser.id);
          
          if (predictionsError) throw new Error(predictionsError.message || 'Failed to fetch user predictions');
          const userPredictions: Prediction[] = predictionsData.map(p => ({
            raceId: p.id_carrera_pred,
            qualifyingTop3: p.top3_clasificacion,
            sprintTop3: p.top3_sprint,
            raceTop10: p.top10_carrera,
            fastestLap: p.vuelta_rapida_piloto_id,
            driverOfTheDay: p.piloto_del_dia_id,
          }));
          setPredictions(userPredictions);
          addLog({ table: 'usuarios_predicciones', operation: 'SELECT', status: 'success', summary: `Fetched user predictions for ${currentUser.id}`, startTime: Date.now() });

        } catch (error: any) {
          console.error("Error loading user game data from Supabase:", error);
          addLog({ table: 'user_game_data', operation: 'SELECT', status: 'error', summary: `Failed to load user game data for ${currentUser.id}`, error: error.message || String(error), startTime: userStartTime });
          setUserF1Team(DEFAULT_USER_F1_TEAM);
          setPredictions([]);
          setCurrentUserScores([]); 
        } finally {
          setLoadingUserGameData(false);
        }
      } else {
        setUserF1Team(DEFAULT_USER_F1_TEAM);
        setPredictions([]);
        setCurrentUserScores([]); 
        setLoadingUserGameData(false);
      }
    };

    loadUserGameData();
  }, [currentUser, addLog, fetchUserRankingsAndProfiles, fetchCurrentUserScores]);

  const getRaceById = (raceId: string) => races.find(r => r.id === raceId);
  const getDriverById = (driverId: string) => drivers.find(d => d.id === driverId);
  const getTeamById = (teamId: string) => teams.find(t => t.id === teamId);
  
  const getUserRankInfo = (userId: string) => userRankings.find(r => r.user_id === userId);
  const getLatestUserScoreEvent = (userId: string) => {
    if (!currentUserScores || currentUserScores.length === 0) return undefined;
    const userSpecificScores = currentUserScores
        .filter(s => s.user_id === userId)
        .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime());
    return userSpecificScores[0];
  };
  const getUserProfileById = (userId: string) => rankedUserProfiles.find(p => p.id === userId);


  const updateUserF1Team = async (team: UserF1Team) => {
    if (!currentUser) throw new Error("Usuario no autenticado.");
    setLoadingUserGameData(true);
    const startTime = Date.now();
    try {
      const teamPayload = {
        id_usuario: currentUser.id,
        pilotos_seleccionados: team.drivers,
        constructores_seleccionados: team.constructors,
        cambios_restantes: team.changesRemaining,
        ultima_modificacion: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('usuarios_f1_equipos_seleccion')
        .upsert(teamPayload, { onConflict: 'id_usuario' });
      if (error) throw new Error(error.message || 'Failed to update F1 team');
      setUserF1Team(team);
      addLog({ table: 'usuarios_f1_equipos_seleccion', operation: 'UPSERT', status: 'success', summary: `Updated F1 team for ${currentUser.id}`, startTime });
    } catch (error: any) {
      console.error("Error saving F1 team to Supabase:", error);
      addLog({ table: 'usuarios_f1_equipos_seleccion', operation: 'UPSERT', status: 'error', summary: `Failed to update F1 team for ${currentUser.id}`, error: error.message || String(error), startTime });
      throw error;
    } finally {
      setLoadingUserGameData(false);
    }
  };

  const savePrediction = async (prediction: Prediction) => {
    if (!currentUser) throw new Error("Usuario no autenticado.");
    setLoadingUserGameData(true);
    const startTime = Date.now();
    try {
      const predictionPayload = {
        id_usuario: currentUser.id,
        id_carrera_pred: prediction.raceId,
        top3_clasificacion: prediction.qualifyingTop3,
        top3_sprint: prediction.sprintTop3,
        top10_carrera: prediction.raceTop10,
        vuelta_rapida_piloto_id: prediction.fastestLap,
        piloto_del_dia_id: prediction.driverOfTheDay,
        fecha_prediccion: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('usuarios_predicciones')
        .upsert(predictionPayload, { onConflict: 'id_usuario,id_carrera_pred' }); 

      if (error) throw new Error(error.message || 'Failed to save prediction');
      
      setPredictions(prev => {
        const existingIndex = prev.findIndex(p => p.raceId === prediction.raceId);
        if (existingIndex > -1) {
          const newPredictions = [...prev];
          newPredictions[existingIndex] = prediction;
          return newPredictions;
        }
        return [...prev, prediction];
      });
      addLog({ table: 'usuarios_predicciones', operation: 'UPSERT', status: 'success', summary: `Saved prediction for race ${prediction.raceId} by ${currentUser.id}`, startTime });
    } catch (error: any) {
      console.error("Error saving prediction to Supabase:", error);
      addLog({ table: 'usuarios_predicciones', operation: 'UPSERT', status: 'error', summary: `Failed to save prediction for ${currentUser.id}`, error: error.message || String(error), startTime });
      throw error;
    } finally {
      setLoadingUserGameData(false);
    }
  };

  const updateUserGuessGameStats = useCallback(async (userId: string, playsToday: number, winsToday: number, lastPlayDate: string) => {
    const startTime = Date.now();
    try {
      const { error } = await supabase
        .from('perfiles_usuarios')
        .update({ 
          guess_game_plays_today: playsToday,
          guess_game_wins_today: winsToday,
          guess_game_last_play_date: lastPlayDate 
        })
        .eq('id', userId);
      if (error) throw new Error(error.message || 'Failed to update guess game stats');
      addLog({ table: 'perfiles_usuarios', operation: 'UPDATE', status: 'success', summary: `Updated guess game stats for user ${userId}`, startTime });
      
      if (currentUser && supabase.auth.getUser && authFetchUserProfile) {
         const { data: { user: supaUser } } = await supabase.auth.getUser();
         if (supaUser) {
            const updatedProfile = await authFetchUserProfile(supaUser); 
            updateCurrentLocalUser(updatedProfile); 
         }
      }
    } catch (error: any) {
      console.error('Error updating user guess game stats:', error);
      addLog({ table: 'perfiles_usuarios', operation: 'UPDATE', status: 'error', summary: `Failed to update guess game stats for ${userId}`, error: error.message || String(error), startTime });
      throw error;
    }
  }, [addLog, currentUser, authFetchUserProfile, updateCurrentLocalUser]);

  const recordGuessGameScore = useCallback(async (userId: string, points: number, eventDate: string) => {
    const startTime = Date.now();
    try {
      const { data: existingScore, error: fetchError } = await supabase
        .from('user_scores')
        .select('id, score_guess_the_pilot')
        .eq('user_id', userId)
        .eq('event_date', eventDate)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') { 
        throw new Error(fetchError.message || 'Database error fetching existing score for guess game.');
      }

      if (existingScore) {
        const { error: updateError } = await supabase
          .from('user_scores')
          .update({ score_guess_the_pilot: (existingScore.score_guess_the_pilot || 0) + points })
          .eq('id', existingScore.id);
        if (updateError) throw new Error(updateError.message || 'Database error updating guess game score.');
        addLog({ table: 'user_scores', operation: 'UPDATE', status: 'success', summary: `Updated guess game score by ${points} for ${userId} on ${eventDate}`, startTime });
      } else {
        const { error: insertError } = await supabase
          .from('user_scores')
          .insert({
            user_id: userId,
            event_date: eventDate,
            score_team: 0, 
            score_predictions: 0,
            score_guess_the_pilot: points,
          });
        if (insertError) throw new Error(insertError.message || 'Database error inserting new guess game score.');
        addLog({ table: 'user_scores', operation: 'INSERT', status: 'success', summary: `Recorded new guess game score ${points} for ${userId} on ${eventDate}`, startTime });
      }
      await fetchCurrentUserScores(userId);
      await fetchUserRankingsAndProfiles();

    } catch (error: any) {
      console.error('Error recording guess game score:', error.message || error);
      addLog({ table: 'user_scores', operation: 'UPSERT', status: 'error', summary: `Failed to record guess game score for ${userId}`, error: error.message || String(error), startTime });
      throw new Error(error.message || 'Failed to record guess game score. Please try again.');
    }
  }, [addLog, fetchCurrentUserScores, fetchUserRankingsAndProfiles]);
  
  const resetUserGameData = async () => {
    if (!currentUser) throw new Error("Usuario no autenticado.");
    setLoadingUserGameData(true);
    const startTime = Date.now();
    try {
      const { error: deletePredictionsError } = await supabase.from('usuarios_predicciones').delete().eq('id_usuario', currentUser.id);
      if (deletePredictionsError) throw new Error(deletePredictionsError.message || 'Failed to delete user predictions.');
      addLog({ table: 'usuarios_predicciones', operation: 'DELETE', status: 'success', summary: `Deleted predictions for ${currentUser.id}`, startTime: Date.now() });

      const defaultSupabaseTeam = {
        id_usuario: currentUser.id,
        pilotos_seleccionados: DEFAULT_USER_F1_TEAM.drivers,
        constructores_seleccionados: DEFAULT_USER_F1_TEAM.constructors,
        cambios_restantes: DEFAULT_USER_F1_TEAM.changesRemaining, 
        ultima_modificacion: new Date().toISOString(),
      };
      const { error: upsertTeamError } = await supabase.from('usuarios_f1_equipos_seleccion').upsert(defaultSupabaseTeam, { onConflict: 'id_usuario' });
      if (upsertTeamError) throw new Error(upsertTeamError.message || 'Failed to reset F1 team.');
      addLog({ table: 'usuarios_f1_equipos_seleccion', operation: 'UPSERT', status: 'success', summary: `Reset F1 team for ${currentUser.id}`, startTime: Date.now() });
      
      const { error: deleteScoresError } = await supabase.from('user_scores').delete().eq('user_id', currentUser.id);
      if (deleteScoresError) throw new Error(deleteScoresError.message || 'Failed to delete user scores.');
      addLog({ table: 'user_scores', operation: 'DELETE', status: 'success', summary: `Deleted scores for ${currentUser.id}`, startTime: Date.now() });

      const { error: updateProfileError } = await supabase.from('perfiles_usuarios').update({
        guess_game_plays_today: 0,
        guess_game_wins_today: 0,
        guess_game_last_play_date: null
      }).eq('id', currentUser.id);
      if (updateProfileError) throw new Error(updateProfileError.message || 'Failed to reset guess game stats in profile.');
      addLog({ table: 'perfiles_usuarios', operation: 'UPDATE', status: 'success', summary: `Reset guess game stats for ${currentUser.id}`, startTime: Date.now() });

      setUserF1Team(DEFAULT_USER_F1_TEAM);
      setPredictions([]);
      setCurrentUserScores([]); 
      
      if (supabase.auth.getUser && authFetchUserProfile) {
        const { data: { user: supaUser } } = await supabase.auth.getUser();
        if (supaUser) {
             const updatedProfile = await authFetchUserProfile(supaUser); 
             updateCurrentLocalUser(updatedProfile);
        }
      }
      await fetchUserRankingsAndProfiles(); 
      
      addLog({ table: 'user_game_data', operation: 'OTHER', status: 'success', summary: `User game data reset successfully for ${currentUser.id}`, startTime });
    } catch (error: any) {
      console.error("Error resetting user game data in Supabase:", error);
      addLog({ table: 'user_game_data', operation: 'OTHER', status: 'error', summary: `Failed to reset user game data for ${currentUser.id}`, error: error.message || String(error), startTime });
      throw error; // Re-throw the error to be caught by ProfilePage
    } finally {
      setLoadingUserGameData(false);
    }
  };
  
  const updateRaceResults = async (raceId: string, results: Partial<Pick<F1Race, 'polePositionRealPilotId' | 'raceTop10Real' | 'fastestLapRealPilotId' | 'driverOfTheDayRealPilotId'>>) => {
    const startTime = Date.now();
    try {
        const payload: any = {
            pole_position_real_piloto_id: results.polePositionRealPilotId,
            race_top_10_real: results.raceTop10Real,
            vuelta_rapida_real_piloto_id: results.fastestLapRealPilotId,
            piloto_del_dia_real_piloto_id: results.driverOfTheDayRealPilotId,
        };
        Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

        const { error } = await supabase
            .from('f1_carreras_predeterminadas')
            .update(payload)
            .eq('id_carrera_pred', raceId);
        if (error) throw new Error(error.message || `Failed to update results for race ${raceId}`);
        
        setRaces(prevRaces => prevRaces.map(r => r.id === raceId ? { ...r, ...results, mockPodium: r.mockPodium } : r));
        addLog({ table: 'f1_carreras_predeterminadas', operation: 'UPDATE', status: 'success', summary: `Updated results for race ${raceId}`, startTime });
    } catch (error: any) {
        console.error(`Error updating race results for ${raceId}:`, error);
        addLog({ table: 'f1_carreras_predeterminadas', operation: 'UPDATE', status: 'error', summary: `Failed to update results for race ${raceId}`, error: error.message || String(error), startTime });
        throw error;
    }
  };

  const triggerScoreCalculation = async (raceId: string) => {
    const startTime = Date.now();
    try {
      const { data, error } = await supabase.functions.invoke('calculate-scores', {
        body: { raceId }
      });

      if (error) throw new Error(error.message || `Failed to trigger score calculation for race ${raceId}`);
      addLog({ table: 'EdgeFunction:calculate-scores', operation: 'RPC', status: 'success', summary: `Triggered score calculation for race ${raceId}`, startTime, error: JSON.stringify(data) });
      await fetchUserRankingsAndProfiles();
      if(currentUser) await fetchCurrentUserScores(currentUser.id);
      return data;
    } catch (error: any) {
      console.error(`Error triggering score calculation for race ${raceId}:`, error);
      addLog({ table: 'EdgeFunction:calculate-scores', operation: 'RPC', status: 'error', summary: `Failed to trigger score calculation for ${raceId}`, error: error.message || String(error), startTime });
      throw error;
    }
  };


  const getPredictionForRace = (raceId: string) => predictions.find(p => p.raceId === raceId);

  return (
    <DataContext.Provider value={{ 
      teams, drivers, races, driverStandings, constructorStandings,
      userF1Team, predictions, news, loadingData, loadingUserGameData,
      userRankings, rankedUserProfiles, currentUserScores, 
      getRaceById, getDriverById, getTeamById,
      updateUserF1Team, savePrediction, getPredictionForRace, fetchNews,
      resetUserGameData,
      recordGuessGameScore, updateUserGuessGameStats,
      getUserRankInfo, getLatestUserScoreEvent, getUserProfileById,
      updateRaceResults, triggerScoreCalculation
    }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = (): DataContextType => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
