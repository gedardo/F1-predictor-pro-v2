import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { User } from '../types';
import type { AuthChangeEvent, Session, User as SupabaseUser } from '@supabase/supabase-js';
import { useLogger } from './LoggingContext';

interface AuthContextType {
  currentUser: User | null;
  session: Session | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, pass: string, nickname: string) => Promise<void>; 
  fetchUserProfile: (supabaseUser: SupabaseUser) => Promise<User>; 
  updateCurrentLocalUser: (updatedUserFields: Partial<User>) => void;
  authError: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const { addLog } = useLogger();

  const createShellUser = (supabaseUser: SupabaseUser, reason: string): User => {
    addLog({ table: 'perfiles_usuarios', operation: 'SELECT', status: 'info', summary: `Creating shell user for ${supabaseUser.id} due to: ${reason}` });
    return {
      id: supabaseUser.id,
      email: supabaseUser.email || '',
      nickname: supabaseUser.user_metadata?.nickname || supabaseUser.email?.split('@')[0] || 'Usuario',
      createdAt: supabaseUser.created_at || new Date().toISOString(),
      avatarUrl: supabaseUser.user_metadata?.avatar_url || null,
      guessGamePlaysToday: 0,
      guessGameWinsToday: 0,
      guessGameLastPlayDate: null,
    };
  };

  const fetchUserProfile = useCallback(async (supabaseUser: SupabaseUser): Promise<User> => {
    const startTime = Date.now();
    try {
      // Ensure this select matches the corrected perfiles_usuarios schema in types_db.ts
      const { data: profile, error } = await supabase
        .from('perfiles_usuarios')
        .select('id, email, nickname, fecha_creacion, avatar_url, guess_game_plays_today, guess_game_wins_today, guess_game_last_play_date')
        .eq('id', supabaseUser.id)
        .single();

      if (error && error.code !== 'PGRST116') { 
        console.error('Error fetching user profile:', error.message || JSON.stringify(error));
        const reason = `DB error (${error.code || 'UNKNOWN_DB_ERROR'}: ${error.message || 'No message details'})`;
        addLog({ table: 'perfiles_usuarios', operation: 'SELECT', status: 'error', summary: `Fetch profile error for ${supabaseUser.id}, creating shell.`, error: error.message || JSON.stringify(error), startTime });
        return createShellUser(supabaseUser, reason);
      }
      
      if (profile) {
        addLog({ table: 'perfiles_usuarios', operation: 'SELECT', status: 'success', summary: `Fetched profile for ${supabaseUser.id}`, startTime });
        return {
          id: profile.id,
          email: profile.email,
          nickname: profile.nickname, 
          createdAt: profile.fecha_creacion,
          avatarUrl: profile.avatar_url,
          guessGamePlaysToday: profile.guess_game_plays_today ?? 0,
          guessGameWinsToday: profile.guess_game_wins_today ?? 0,
          guessGameLastPlayDate: profile.guess_game_last_play_date,
        };
      }
      
      addLog({ table: 'perfiles_usuarios', operation: 'SELECT', status: 'info', summary: `No profile found for ${supabaseUser.id} (PGRST116 or new user), creating shell.`, startTime });
      return createShellUser(supabaseUser, 'No profile row found (PGRST116 or new user)');
    } catch (e: any) {
      console.error('Exception fetching profile, creating shell:', e.message || JSON.stringify(e));
      addLog({ table: 'perfiles_usuarios', operation: 'SELECT', status: 'error', summary: `Exception fetching profile for ${supabaseUser.id}, creating shell.`, error: e.message || JSON.stringify(e), startTime });
      return createShellUser(supabaseUser, `Exception (${e.message || 'No exception message'})`);
    }
  }, [addLog]);
  
  const updateCurrentLocalUser = (updatedUserFields: Partial<User>) => {
    setCurrentUser(prevUser => {
      if (!prevUser) return null;
      return { ...prevUser, ...updatedUserFields };
    });
  };


  useEffect(() => {
    setLoading(true);
    setAuthError(null);
    let timeoutId: any = null;
    const getInitialSession = async () => {
      console.log('[Auth] Chequeando sesión...');
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        setSession(initialSession);
        if (initialSession?.user) {
          console.log('[Auth] Sesión encontrada:', initialSession.user.email);
          const userProfile = await fetchUserProfile(initialSession.user);
          setCurrentUser(userProfile);
        } else {
          console.log('[Auth] No hay usuario en sesión.');
          setCurrentUser(null);
        }
      } catch (error: any) {
        console.error('[Auth] Error en getInitialSession:', error.message || JSON.stringify(error));
        setCurrentUser(null); 
        setAuthError('No se pudo recuperar la sesión de usuario. Intenta recargar la página.');
      } finally {
        setLoading(false);
        if (timeoutId) clearTimeout(timeoutId);
      }
    };
    getInitialSession();

    // Timeout para evitar spinner infinito
    timeoutId = setTimeout(() => {
      setLoading(false);
      setAuthError('No se pudo recuperar la sesión. Intenta recargar la página o vuelve a iniciar sesión.');
      console.error('[Auth] Timeout: sesión no recuperada tras 5 segundos.');
    }, 5000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Auth] Volviendo a la pestaña, re-chequeando sesión...');
        getInitialSession();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const { data: authListenerData } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, sessionState: Session | null) => {
        setLoading(true);
        setSession(sessionState); 
        addLog({ table: 'auth', operation: 'AUTH', status: 'success', summary: `Auth event: ${event}`, error: `Session user ID: ${sessionState?.user?.id ?? 'none'}` });

        if (sessionState?.user) {
          const userProfile = await fetchUserProfile(sessionState.user);
          setCurrentUser(userProfile);
        } else {
          if (event === 'SIGNED_OUT') {
            setCurrentUser(null);
          } else if (event === 'INITIAL_SESSION' && !sessionState) {
            setCurrentUser(null);
          }
        }
        setLoading(false);
      }
    );

    return () => {
      authListenerData?.subscription?.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibility);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [fetchUserProfile, addLog]);

  const login = async (email: string, pass: string): Promise<void> => {
    setLoading(true);
    const startTime = Date.now();
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      addLog({ table: 'auth', operation: 'AUTH', status: 'success', summary: `Login attempt for ${email}`, startTime });
    } catch (error: any) {
      console.error("Error en login:", error.message || JSON.stringify(error));
      addLog({ table: 'auth', operation: 'AUTH', status: 'error', summary: `Login failed for ${email}`, error: error.message || JSON.stringify(error), startTime });
      setLoading(false); 
      throw error;
    }
  };

  const signup = async (email: string, pass: string, nickname: string): Promise<void> => {
    setLoading(true);
    const startTime = Date.now();
    try {
      const { data: signUpData, error } = await supabase.auth.signUp({
        email,
        password: pass,
        options: {
          data: { 
            nickname: nickname, // This nickname should be used by the handle_new_user trigger
          }
        }
      });

      if (error) throw error;
      if (!signUpData.user) throw new Error("Signup successful but no user data returned.");
      
      addLog({ table: 'auth', operation: 'AUTH', status: 'success', summary: `Signup for ${email} with nickname ${nickname}`, startTime });
    } catch (error: any)
     {
      console.error("Error en signup:", error.message || JSON.stringify(error));
      addLog({ table: 'auth', operation: 'AUTH', status: 'error', summary: `Signup failed for ${email}`, error: error.message || JSON.stringify(error), startTime });
      setLoading(false); 
      throw error;
    }
  };

  const logout = async (): Promise<void> => {
    setLoading(true); 
    const startTime = Date.now();
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      addLog({ table: 'auth', operation: 'AUTH', status: 'success', summary: 'User signed out', startTime });
    } catch (error: any) {
      console.error("Error en logout:", error.message || JSON.stringify(error));
      addLog({ table: 'auth', operation: 'AUTH', status: 'error', summary: 'Sign out failed', error: error.message || JSON.stringify(error), startTime });
      setLoading(false); 
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ currentUser, session, loading, login, logout, signup, fetchUserProfile, updateCurrentLocalUser, authError }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
