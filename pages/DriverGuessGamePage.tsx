
import React, { useState, useEffect, useCallback } from 'react';
import { useData } from '../contexts/DataContext';
import { useAuth } from '../contexts/AuthContext';
import { F1Driver, LetterState, GameLetter } from '../types';
import Keyboard from '../components/game/Keyboard';
import GuessInputRow from '../components/game/GuessInputRow';
import LoadingSpinner from '../components/LoadingSpinner';
import { CheckCircle, XCircle, RotateCcw, Info, ShieldAlert } from 'lucide-react';

const MAX_INSTANCES_PER_DAY = 3; // Max number of separate game instances user can play
const MAX_ATTEMPTS_PER_INSTANCE = 5; // Max attempts for each game instance

const normalizeString = (str: string): string => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-ZÑ]/g, ""); // Keep A-Z and Ñ
};

const DriverGuessGamePage: React.FC = () => {
  const { drivers: f1Drivers, recordGuessGameScore, updateUserGuessGameStats } = useData();
  const { currentUser, loading: authLoading } = useAuth();

  const [targetDriver, setTargetDriver] = useState<F1Driver | null>(null);
  const [targetSurname, setTargetSurname] = useState<string>('');
  
  const [gameState, setGameState] = useState<'idle' | 'playing' | 'won' | 'lost' | 'no_more_plays'>('idle');
  const [guesses, setGuesses] = useState<GameLetter[][]>([]);
  const [currentAttemptInInstance, setCurrentAttemptInInstance] = useState(0);
  const [currentInput, setCurrentInput] = useState<string>('');
  const [letterStatuses, setLetterStatuses] = useState<Record<string, LetterState>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'info' | 'success' | 'error' | 'warning'>('info');

  // Daily play tracking
  const [dailyPlaysMade, setDailyPlaysMade] = useState(0);
  const [dailyWins, setDailyWins] = useState(0);
  const [isDailyStatsInitialized, setIsDailyStatsInitialized] = useState(false);


  const initializeDailyStats = useCallback(async () => {
    if (!currentUser) return;
    setIsDailyStatsInitialized(false);
    const todayUTC = new Date().toISOString().split('T')[0];
    let plays = currentUser.guessGamePlaysToday || 0;
    let wins = currentUser.guessGameWinsToday || 0;

    if (currentUser.guessGameLastPlayDate !== todayUTC) {
      plays = 0;
      wins = 0;
      // Update in DB for new day
      await updateUserGuessGameStats(currentUser.id, 0, 0, todayUTC);
    }
    setDailyPlaysMade(plays);
    setDailyWins(wins);
    setIsDailyStatsInitialized(true);
    if (plays >= MAX_INSTANCES_PER_DAY) {
        setGameState('no_more_plays');
        setMessage(`Has completado tus ${MAX_INSTANCES_PER_DAY} partidas de hoy. ¡Vuelve mañana!`);
        setMessageType('warning');
    }
  }, [currentUser, updateUserGuessGameStats]);

  useEffect(() => {
    if (currentUser && !authLoading) {
      initializeDailyStats();
    }
  }, [currentUser, authLoading, initializeDailyStats]);


  const startGameInstance = useCallback(() => {
    if (!f1Drivers || f1Drivers.length === 0) {
        setMessage("Cargando pilotos... Intenta de nuevo en un momento.");
        setMessageType('info');
        setGameState('idle');
        return;
    }
    if (dailyPlaysMade >= MAX_INSTANCES_PER_DAY) {
        setGameState('no_more_plays');
        setMessage(`Has completado tus ${MAX_INSTANCES_PER_DAY} partidas de hoy. ¡Vuelve mañana!`);
        setMessageType('warning');
        return;
    }

    let randomDriver;
    let surname = '';
    let normalizedSurname = '';
    let attempts = 0;
    const MAX_INIT_ATTEMPTS = 10; // Prevent infinite loop if all drivers have short names

    // Try to find a driver with a surname of at least 3 characters
    while (normalizedSurname.length < 3 && attempts < MAX_INIT_ATTEMPTS) {
        randomDriver = f1Drivers[Math.floor(Math.random() * f1Drivers.length)];
        surname = randomDriver.name.split(' ').pop() || '';
        normalizedSurname = normalizeString(surname);
        attempts++;
    }
    
    if (normalizedSurname.length < 3) {
        setMessage("No se pudo iniciar el juego con un piloto válido. Por favor, recarga la página.");
        setMessageType('error');
        setGameState('idle');
        return;
    }

    setTargetDriver(randomDriver!);
    setTargetSurname(normalizedSurname);
    
    setGuesses(Array(MAX_ATTEMPTS_PER_INSTANCE).fill(null).map(() => 
      Array(normalizedSurname.length).fill(null).map(() => ({ char: '', state: 'empty' }))
    ));
    setCurrentAttemptInInstance(0);
    setCurrentInput('');
    setLetterStatuses({}); // Reset letter statuses for new game instance
    setGameState('playing');
    setMessage(null);
    setMessageType('info');
  }, [f1Drivers, dailyPlaysMade]);

  useEffect(() => {
    if (gameState === 'idle' && isDailyStatsInitialized && dailyPlaysMade < MAX_INSTANCES_PER_DAY && f1Drivers.length > 0) {
      // This is the initial screen before any game play, or when user clicks "Play Again" and has plays left.
      // Do not auto-start; user clicks "COMENZAR A JUGAR"
    }
  }, [gameState, isDailyStatsInitialized, dailyPlaysMade, f1Drivers]);

  const evaluateGuess = (guessStr: string): GameLetter[] => {
    const evaluation: GameLetter[] = guessStr.split('').map(char => ({ char, state: 'absent' }));
    const targetChars = targetSurname.split('');
    const usedTargetIndices = new Array(targetSurname.length).fill(false);

    for (let i = 0; i < guessStr.length; i++) {
      if (guessStr[i] === targetChars[i]) {
        evaluation[i].state = 'correct';
        usedTargetIndices[i] = true;
      }
    }
    for (let i = 0; i < guessStr.length; i++) {
      if (evaluation[i].state === 'correct') continue;
      const charIndexInTarget = targetChars.findIndex(
        (targetChar, index) => targetChar === guessStr[i] && !usedTargetIndices[index]
      );
      if (charIndexInTarget !== -1) {
        evaluation[i].state = 'present';
        usedTargetIndices[charIndexInTarget] = true;
      }
    }
    return evaluation;
  };

  const handleKeyPress = useCallback((key: string) => {
    if (gameState !== 'playing') return;
    setMessage(null);

    if (key === 'Enter') {
      if (currentInput.length === targetSurname.length) {
        submitGuess();
      } else {
        setMessage(`El apellido debe tener ${targetSurname.length} letras.`);
        setMessageType('info');
      }
    } else if (key === 'Backspace') {
      setCurrentInput(prev => prev.slice(0, -1));
    } else if (currentInput.length < targetSurname.length && /^[A-ZÑ]$/i.test(key)) {
      setCurrentInput(prev => prev + key.toUpperCase());
    }
  }, [gameState, currentInput, targetSurname.length]);
  
  const submitGuess = async () => {
    if (!currentUser) return;

    const evaluatedGuess = evaluateGuess(currentInput);
    const newGuesses = [...guesses];
    newGuesses[currentAttemptInInstance] = evaluatedGuess;
    setGuesses(newGuesses);

    const newLetterStatuses = { ...letterStatuses };
    evaluatedGuess.forEach(({ char, state }) => {
      const upperChar = char.toUpperCase();
      const currentHighestState = newLetterStatuses[upperChar];
      if (state === 'correct' || 
          (state === 'present' && currentHighestState !== 'correct') ||
          (state === 'absent' && !currentHighestState)) {
        newLetterStatuses[upperChar] = state;
      }
    });
    setLetterStatuses(newLetterStatuses);

    const todayUTC = new Date().toISOString().split('T')[0];
    let newDailyPlays = dailyPlaysMade;
    let newDailyWins = dailyWins;
    let pointsThisInstance = 0;

    if (currentInput === targetSurname) { // Player won this instance
      setGameState('won');
      setMessage(`¡Correcto! El piloto era ${targetDriver?.name}. ¡Has ganado 10 puntos!`);
      setMessageType('success');
      pointsThisInstance = 10;
      newDailyWins = dailyWins + 1;
    } else if (currentAttemptInInstance === MAX_ATTEMPTS_PER_INSTANCE - 1) { // Player lost this instance
      setGameState('lost');
      setMessage(`¡Se acabaron los intentos! El piloto era ${targetDriver?.name} (${targetSurname}).`);
      setMessageType('error');
    } else { // Game continues
      setCurrentAttemptInInstance(prev => prev + 1);
      setCurrentInput('');
      return; // Don't update daily stats until instance is over
    }

    // Instance ended (win or loss)
    newDailyPlays = dailyPlaysMade + 1;
    setDailyPlaysMade(newDailyPlays);
    setDailyWins(newDailyWins); // newDailyWins already updated if it was a win

    // Check for bonus if it was the 3rd play AND 3rd win
    if (newDailyPlays === MAX_INSTANCES_PER_DAY && newDailyWins === MAX_INSTANCES_PER_DAY && pointsThisInstance > 0) {
      pointsThisInstance += 20; // Add bonus
      setMessage(prev => prev + " ¡Bonus de 20 puntos por 3 victorias hoy!");
    }

    if (pointsThisInstance > 0) {
      await recordGuessGameScore(currentUser.id, pointsThisInstance, todayUTC);
    }
    await updateUserGuessGameStats(currentUser.id, newDailyPlays, newDailyWins, todayUTC);

    if (newDailyPlays >= MAX_INSTANCES_PER_DAY && gameState !== 'no_more_plays') {
        // Set a slight delay to show win/loss message before "no_more_plays"
        setTimeout(() => {
            setGameState('no_more_plays');
            setMessage(prev => prev + `\nHas completado tus ${MAX_INSTANCES_PER_DAY} partidas de hoy. ¡Vuelve mañana!`);
            setMessageType('warning');
        }, 2000);
    }
  };

  useEffect(() => {
    if (gameState === 'playing' && targetSurname.length > 0) {
      const newGuesses = [...guesses];
      const currentRow = Array(targetSurname.length).fill(null).map((_, i) => ({
        char: currentInput[i] || '',
        state: 'empty' as LetterState
      }));
      if (currentAttemptInInstance < MAX_ATTEMPTS_PER_INSTANCE) {
        newGuesses[currentAttemptInInstance] = currentRow;
        setGuesses(newGuesses);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentInput, currentAttemptInInstance, gameState, targetSurname]);

  useEffect(() => {
    const listener = (e: globalThis.KeyboardEvent) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        let keyToPress = e.key.toUpperCase();
        if (keyToPress === 'ENTER') keyToPress = 'Enter';
        if (keyToPress === 'BACKSPACE') keyToPress = 'Backspace';
        
        if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
            return; // Don't interfere if user is typing in a form elsewhere
        }

        if (/^[A-ZÑ]$/.test(keyToPress) || keyToPress === 'Enter' || keyToPress === 'Backspace') {
            handleKeyPress(keyToPress);
        }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [handleKeyPress]);

  if (authLoading || !isDailyStatsInitialized) {
    return <div className="flex justify-center items-center min-h-screen"><LoadingSpinner message="Cargando juego..." /></div>;
  }
  
  if (f1Drivers.length === 0 && !authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-12rem)] p-4 text-center" style={{background: '#0D1B3A', color: '#F0E0B0'}}>
        <ShieldAlert size={48} className="text-red-400 mb-4" />
        <p className="text-xl">No se pudieron cargar los datos de los pilotos.</p>
        <p className="text-gray-400">Por favor, intenta recargar la página o vuelve más tarde.</p>
      </div>
    );
  }

  if (gameState === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-12rem)] p-6 text-center" style={{background: '#0D1B3A', color: '#F0E0B0'}}>
        <div className="bg-[#1A2B4D] p-8 rounded-lg shadow-2xl max-w-lg w-full border-2 border-[#D4AF37]">
            <h1 className="text-3xl font-bold mb-2 text-[#D4AF37]">¡ADIVINA EL PILOTO!</h1>
            <div className="text-xs uppercase tracking-wider mb-6 text-[#D4AF37]">Edición F1 2025</div>
            
            <ul className="space-y-2 text-sm text-left mb-8 text-gray-300 list-disc list-inside">
                <li>Adivina el APELLIDO del piloto en {MAX_ATTEMPTS_PER_INSTANCE} intentos.</li>
                <li>Puedes jugar {MAX_INSTANCES_PER_DAY} partidas al día.</li>
                <li>Cada partida ganada otorga 10 puntos.</li>
                <li>Si ganas las {MAX_INSTANCES_PER_DAY} partidas del día, ¡recibes un bonus de 20 puntos extra!</li>
                <li><span className="inline-block w-4 h-4 bg-green-500 rounded-sm align-middle mr-1"></span>Letra correcta y en posición correcta.</li>
                <li><span className="inline-block w-4 h-4 bg-yellow-500 rounded-sm align-middle mr-1"></span>Letra correcta pero en posición incorrecta.</li>
                <li><span className="inline-block w-4 h-4 bg-gray-500 rounded-sm align-middle mr-1"></span>Letra incorrecta.</li>
            </ul>
            <p className="text-yellow-300 mb-4 text-sm">Partidas restantes hoy: {Math.max(0, MAX_INSTANCES_PER_DAY - dailyPlaysMade)}</p>
            <button
                onClick={startGameInstance}
                disabled={dailyPlaysMade >= MAX_INSTANCES_PER_DAY}
                className="w-full bg-[#D4AF37] text-[#0D1B3A] font-bold py-3 px-6 rounded-md text-lg hover:bg-yellow-400 transition-colors duration-200 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {dailyPlaysMade >= MAX_INSTANCES_PER_DAY ? "No Más Partidas Hoy" : "COMENZAR A JUGAR"}
            </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-start min-h-[calc(100vh-8rem)] pt-8 p-4" style={{background: '#0D1B3A', color: '#F0E0B0'}}>
      <h1 className="text-3xl sm:text-4xl font-bold mb-1 text-[#D4AF37]">Adivina el Piloto</h1>
      <p className="text-sm text-gray-400 mb-1">Partida {dailyPlaysMade + (gameState === 'playing' || gameState === 'won' || gameState === 'lost' ? 1 : 0)} de {MAX_INSTANCES_PER_DAY}</p>
      {gameState === 'playing' && <p className="text-sm text-gray-400 mb-4">Intentos restantes: {MAX_ATTEMPTS_PER_INSTANCE - currentAttemptInInstance}</p>}
      
      <div className="space-y-1.5 sm:space-y-2 my-4">
        {guesses.map((guessRow, index) => (
          <GuessInputRow
            key={index}
            guess={guessRow}
            wordLength={targetSurname.length}
            isSubmitted={index < currentAttemptInInstance || gameState === 'won' || gameState === 'lost'}
          />
        ))}
      </div>

      {message && (
        <div className={`my-4 p-3 rounded-md text-center text-sm max-w-md transition-all duration-300 ease-in-out transform ${message ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}
          ${messageType === 'success' ? 'bg-green-600 text-green-100 border border-green-500' : 
            messageType === 'error' ? 'bg-red-600 text-red-100 border border-red-500' : 
            messageType === 'warning' ? 'bg-yellow-600 text-yellow-100 border border-yellow-500' :
            'bg-blue-700 text-blue-100 border border-blue-500'}`}
            role="alert"
        >
          {messageType === 'success' && <CheckCircle className="inline mr-2" />}
          {messageType === 'error' && <XCircle className="inline mr-2" />}
          {messageType === 'warning' && <ShieldAlert className="inline mr-2" />}
          {messageType === 'info' && <Info className="inline mr-2" />}
          {message.split('\n').map((line, i) => <span key={i} className="block">{line}</span>)}
        </div>
      )}

      {(gameState === 'won' || gameState === 'lost') && dailyPlaysMade < MAX_INSTANCES_PER_DAY && (
        <button
          onClick={startGameInstance}
          className="mt-4 bg-[#D4AF37] text-[#0D1B3A] font-bold py-2 px-6 rounded-md text-lg hover:bg-yellow-400 transition-colors duration-200 shadow-md flex items-center"
        >
          <RotateCcw size={20} className="mr-2"/> Siguiente Partida
        </button>
      )}
       {(gameState === 'won' || gameState === 'lost') && dailyPlaysMade >= MAX_INSTANCES_PER_DAY && (
        <p className="mt-4 text-yellow-300">Has completado todas tus partidas de hoy. ¡Vuelve mañana!</p>
      )}


      {gameState === 'playing' && targetDriver && (
        <Keyboard onKeyPress={handleKeyPress} letterStates={letterStatuses} />
      )}
       {targetSurname && <p className="text-xs text-gray-500 mt-8">Longitud del apellido: {targetSurname.length} letras.</p>}
    </div>
  );
};

export default DriverGuessGamePage;