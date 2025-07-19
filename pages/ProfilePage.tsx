
import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext'; 
import { useNavigate } from 'react-router-dom';
import { AppRoute, UserScore } from '../types';
import { UserCircle, LogOut, Trash2, AlertTriangle, ListOrdered, Zap, Trophy, Gamepad2, Edit, Save, CheckCircle, XCircle } from 'lucide-react'; 
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal'; 
import { supabase } from '../lib/supabaseClient'; // For nickname check
import { useLogger } from '../contexts/LoggingContext';

const ProfilePage: React.FC = () => {
  const { currentUser, logout, loading: authLoading, fetchUserProfile, updateCurrentLocalUser } = useAuth();
  const { 
    resetUserGameData, loadingUserGameData, userF1Team, predictions,
    getUserRankInfo, getLatestUserScoreEvent, currentUserScores
  } = useData(); 
  const navigate = useNavigate();
  const { addLog } = useLogger();

  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false); 

  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [newNickname, setNewNickname] = useState(currentUser?.nickname || '');
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [nicknameSuccess, setNicknameSuccess] = useState<string | null>(null);
  const [isSavingNickname, setIsSavingNickname] = useState(false);

  useEffect(() => {
    if (currentUser) {
      setNewNickname(currentUser.nickname);
    }
  }, [currentUser]);

  const handleLogout = () => {
    logout();
    navigate(AppRoute.Auth);
  };

  const handleOpenResetModal = () => {
    setIsResetModalOpen(true);
    setResetError(null);
  };

  const handleConfirmReset = async () => {
    setIsResetting(true);
    setResetError(null);
    try {
      await resetUserGameData();
      setIsResetModalOpen(false); 
    } catch (error: any) {
      setResetError(error.message || "Error al reiniciar los datos del juego.");
    } finally {
      setIsResetting(false);
    }
  };

  const handleNicknameEditToggle = () => {
    setIsEditingNickname(!isEditingNickname);
    setNicknameError(null);
    setNicknameSuccess(null);
    if (currentUser) setNewNickname(currentUser.nickname); // Reset to current if cancelling
  };

  const handleSaveNickname = async () => {
    if (!currentUser) return;
    if (!newNickname.trim() || newNickname.trim().length < 3) {
      setNicknameError('El Nick de Usuario debe tener al menos 3 caracteres.');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(newNickname.trim())) {
      setNicknameError('El Nick de Usuario solo puede contener letras, números y guiones bajos (_).');
      return;
    }
    if (newNickname.trim() === currentUser.nickname) {
      setNicknameError('El nuevo nick es igual al actual.');
      setIsEditingNickname(false);
      return;
    }

    setIsSavingNickname(true);
    setNicknameError(null);
    setNicknameSuccess(null);
    const startTime = Date.now();

    try {
      // Check for uniqueness (excluding current user's existing nickname if it were part of the check logic, but DB constraint handles it)
      const { data: existingUser, error: fetchError } = await supabase
        .from('perfiles_usuarios')
        .select('id')
        .eq('nickname', newNickname.trim())
        .neq('id', currentUser.id) // Ensure it's not colliding with another user
        .maybeSingle();

      if (fetchError) {
        addLog({ table: 'perfiles_usuarios', operation: 'SELECT', status: 'error', summary: `Nickname check error for ${newNickname.trim()}`, error: fetchError.message, startTime });
        throw fetchError;
      }

      if (existingUser) {
        setNicknameError('Este Nick de Usuario ya está en uso. Por favor, elige otro.');
        setIsSavingNickname(false);
        return;
      }

      // Update nickname in Supabase
      const { error: updateError } = await supabase
        .from('perfiles_usuarios')
        .update({ nickname: newNickname.trim() })
        .eq('id', currentUser.id);

      if (updateError) {
        addLog({ table: 'perfiles_usuarios', operation: 'UPDATE', status: 'error', summary: `Failed to update nickname for ${currentUser.id}`, error: updateError.message, startTime });
        throw updateError;
      }
      
      addLog({ table: 'perfiles_usuarios', operation: 'UPDATE', status: 'success', summary: `Updated nickname for ${currentUser.id} to ${newNickname.trim()}`, startTime });
      
      // Refresh user profile in AuthContext
      const { data: { user: supaUser } } = await supabase.auth.getUser();
      if (supaUser) {
        const updatedUser = await fetchUserProfile(supaUser); // fetchUserProfile from AuthContext
        updateCurrentLocalUser({ nickname: updatedUser.nickname }); // Update local state in AuthContext
      }
      
      setNicknameSuccess('¡Nick actualizado con éxito!');
      setIsEditingNickname(false);
      setTimeout(() => setNicknameSuccess(null), 3000);

    } catch (error: any) {
      console.error("Error updating nickname:", error);
      setNicknameError(error.message || 'Error al actualizar el nick.');
      if (error.message && (error.message.toLowerCase().includes('duplicate key value violates unique constraint "perfiles_usuarios_nickname_key"'))) {
        setNicknameError('Este Nick de Usuario ya está en uso. Por favor, elige otro.');
      }
    } finally {
      setIsSavingNickname(false);
    }
  };


  if (authLoading || (currentUser && loadingUserGameData && !getUserRankInfo(currentUser.id) && currentUserScores.length === 0)) {
    return <div className="flex justify-center items-center min-h-screen"><LoadingSpinner message="Cargando perfil..." /></div>;
  }

  if (!currentUser) {
    navigate(AppRoute.Auth); 
    return null;
  }

  const currentUserRank = getUserRankInfo(currentUser.id);
  const totalPoints = currentUserRank?.total_overall_score ?? 0;
  const rankPosition = currentUserRank?.rank ?? 'N/A';
  const latestScore = getLatestUserScoreEvent(currentUser.id);
  const lastEventPoints = latestScore?.event_total_score ?? 0;

  const hasGameData = userF1Team.drivers.some(d => d !== null) || predictions.length > 0 || currentUserScores.length > 0;
  
  const sortedUserScores = [...currentUserScores].sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime());

  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8">
      <header className="mb-8 text-center">
        {currentUser.avatarUrl ? 
            <img src={currentUser.avatarUrl} alt="Avatar" className="w-20 h-20 rounded-full mx-auto mb-4 object-cover border-2 border-red-500"/>
            : <UserCircle size={80} className="mx-auto text-red-500 mb-4" />
        }
        <div className="flex items-center justify-center space-x-2">
            <h1 className="text-4xl font-bold text-white"> {currentUser.nickname}</h1>
             <button 
                onClick={handleNicknameEditToggle} 
                className="text-red-400 hover:text-red-300 p-1 rounded-full hover:bg-gray-700 transition-colors"
                title={isEditingNickname ? "Cancelar edición de nick" : "Editar nick"}
                aria-label="Editar Nick de Usuario"
            >
                {isEditingNickname ? <XCircle size={24} /> : <Edit size={24} />}
            </button>
        </div>

        {isEditingNickname && (
            <div className="mt-4 max-w-sm mx-auto bg-gray-700 p-4 rounded-lg shadow-md">
                <label htmlFor="newNickname" className="block text-sm font-medium text-gray-300 mb-1">Nuevo Nick de Usuario:</label>
                <input 
                    type="text"
                    id="newNickname"
                    value={newNickname}
                    onChange={(e) => setNewNickname(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white focus:ring-red-500 focus:border-red-500"
                    disabled={isSavingNickname}
                />
                {nicknameError && <p className="text-xs text-red-300 mt-1">{nicknameError}</p>}
                <button
                    onClick={handleSaveNickname}
                    disabled={isSavingNickname || newNickname.trim() === currentUser.nickname}
                    className="mt-3 w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-md transition-colors disabled:opacity-60 flex items-center justify-center"
                >
                    {isSavingNickname ? <LoadingSpinner size="sm"/> : <Save size={18} className="mr-2" />}
                    Guardar Nick
                </button>
            </div>
        )}
        {nicknameSuccess && <p className="mt-2 text-green-400 text-sm flex items-center justify-center"><CheckCircle size={18} className="mr-1"/>{nicknameSuccess}</p>}


        <p className="text-gray-400 text-lg mt-1">{currentUser.email}</p>
      </header>

      <div className="max-w-3xl mx-auto bg-gray-800 p-6 sm:p-8 rounded-xl shadow-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="p-4 bg-gray-700 rounded-lg text-center">
                <Trophy size={28} className="text-yellow-400 mx-auto mb-2"/>
                <span className="block text-sm text-gray-300">Puntuación Total</span>
                <span className="block text-3xl font-bold text-yellow-400">{totalPoints} pts</span>
            </div>
            <div className="p-4 bg-gray-700 rounded-lg text-center">
                <ListOrdered size={28} className="text-green-400 mx-auto mb-2"/>
                <span className="block text-sm text-gray-300">Ranking Global</span>
                <span className="block text-3xl font-bold text-green-400">#{rankPosition}</span>
            </div>
             <div className="p-4 bg-gray-700 rounded-lg text-center md:col-span-2">
                <Zap size={28} className="text-blue-400 mx-auto mb-2"/>
                <span className="block text-sm text-gray-300">Puntos del Último Evento</span>
                <span className="block text-3xl font-bold text-blue-400">{lastEventPoints} pts</span>
            </div>
        </div>
        
        <div className="mb-8">
            <h3 className="text-xl font-semibold text-red-400 mb-3 flex items-center"><Gamepad2 size={22} className="mr-2"/>Historial de Puntuación</h3>
            {loadingUserGameData && currentUserScores.length === 0 ? <LoadingSpinner message="Cargando historial..." /> :
            sortedUserScores.length > 0 ? (
                <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar pr-2">
                    {sortedUserScores.map((score: UserScore) => (
                        <details key={score.id} className="bg-gray-700 p-3 rounded-lg shadow hover:bg-gray-600/70 transition-colors">
                            <summary className="font-semibold text-gray-100 cursor-pointer flex justify-between items-center list-none">
                                <span>Evento: {new Date(score.event_date).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                                <span className="text-yellow-400 font-bold">{score.event_total_score} pts</span>
                            </summary>
                            <div className="mt-2 pt-2 border-t border-gray-600 text-sm text-gray-300 space-y-1">
                                <p>Puntos Equipo F1: <span className="font-medium text-white">{score.score_team}</span></p>
                                <p>Puntos Predicciones: <span className="font-medium text-white">{score.score_predictions}</span></p>
                                <p>Puntos Adivina Piloto: <span className="font-medium text-white">{score.score_guess_the_pilot}</span></p>
                                <p className="text-xs text-gray-500">Registrado: {new Date(score.created_at).toLocaleString('es-ES')}</p>
                            </div>
                        </details>
                    ))}
                </div>
            ) : (
                <p className="text-gray-400 italic">Aún no has obtenido puntos en ningún evento.</p>
            )}
        </div>
          
        <div className="border-t border-gray-700 pt-6">
            <h3 className="text-xl font-semibold text-red-400 mb-3">Ajustes de Cuenta</h3>
            <p className="text-gray-400 mb-4">Próximamente: Cambiar contraseña, avatar, etc.</p>
            
            <button
                onClick={handleOpenResetModal}
                disabled={loadingUserGameData || isResetting || !hasGameData}
                className="w-full mt-2 flex items-center justify-center py-2 px-4 border border-yellow-600 rounded-md shadow-sm text-sm font-medium text-yellow-300 hover:bg-yellow-700 hover:text-yellow-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 focus:ring-offset-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                 title={!hasGameData ? "No hay datos de juego para reiniciar" : "Reiniciar equipo, predicciones y puntajes"}
            >
                {isResetting ? (
                    <LoadingSpinner size="sm" message="Reiniciando..."/>
                ) : (
                    <><Trash2 size={18} className="mr-2" /> Reiniciar Datos del Juego</>
                )}
            </button>
             {!hasGameData && <p className="text-xs text-gray-500 text-center mt-1">No tienes datos de juego (equipo/predicciones/puntajes) para reiniciar.</p>}
        </div>

        <button
            onClick={handleLogout}
            className="w-full mt-8 flex items-center justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-lg font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 focus:ring-offset-gray-800 transition-colors"
        >
            <LogOut size={20} className="mr-2" />
            Cerrar Sesión
        </button>
      </div>

      <Modal
        isOpen={isResetModalOpen}
        onClose={() => !isResetting && setIsResetModalOpen(false)} 
        title="Confirmar Reinicio de Datos"
      >
        <div className="text-gray-300">
          <p className="mb-4 text-lg flex items-start text-yellow-300">
            <AlertTriangle size={36} className="mr-3 text-yellow-400 flex-shrink-0" style={{ minWidth: '36px'}}/> 
            <span>¡Atención!</span>
          </p>
          <p className="mb-2">Estás a punto de reiniciar todos los datos de tu juego, incluyendo:</p>
          <ul className="list-disc list-inside mb-4 pl-4 space-y-1">
            <li>Tu Equipo F1 seleccionado (volverá al estado por defecto).</li>
            <li>Todas tus predicciones guardadas para las carreras.</li>
            <li>Todo tu historial de puntuación y tu puntaje total.</li>
             <li>Tus estadísticas del juego "Adivina el Piloto" (jugadas/victorias diarias).</li>
          </ul>
          <p className="mb-6 font-semibold">Esta acción no se puede deshacer. ¿Estás seguro de que quieres continuar?</p>
          
          {resetError && <p className="text-red-400 bg-red-900/30 p-2 rounded mb-3 text-sm">{resetError}</p>}

          <div className="flex justify-end space-x-3 mt-4">
            <button
              onClick={() => setIsResetModalOpen(false)}
              disabled={isResetting}
              className="px-4 py-2 rounded-md text-gray-300 bg-gray-600 hover:bg-gray-500 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirmReset}
              disabled={isResetting}
              className="px-4 py-2 rounded-md text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center min-w-[120px] justify-center"
            >
              {isResetting ? <LoadingSpinner size="sm" /> : <Trash2 size={18} className="mr-1.5" />}
              {isResetting ? 'Reiniciando...' : 'Sí, Reiniciar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ProfilePage;
