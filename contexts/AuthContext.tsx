import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { User } from '../types';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';

interface AuthContextType {
  currentUser: User | null;
  session: Session | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, pass: string, nickname: string) => Promise<void>; 
  authError: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Función simplificada para crear usuario
  const createUserFromSupabase = (supabaseUser: SupabaseUser): User => {
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

  useEffect(() => {
    console.log('[Auth] Iniciando AuthProvider...');
    
    // Función para manejar cambios de sesión
    const handleAuthChange = (session: Session | null) => {
      console.log('[Auth] Session change:', session ? 'LOGGED_IN' : 'LOGGED_OUT');
      
      setSession(session);
      
      if (session?.user) {
        const user = createUserFromSupabase(session.user);
        setCurrentUser(user);
        setAuthError(null);
      } else {
        setCurrentUser(null);
      }
      
      setLoading(false);
    };

    // Obtener sesión inicial
    const getInitialSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('[Auth] Error getting session:', error);
          setAuthError('Error al obtener sesión');
        } else {
          console.log('[Auth] Initial session:', session ? 'EXISTS' : 'NONE');
          handleAuthChange(session);
        }
      } catch (error) {
        console.error('[Auth] Exception getting session:', error);
        setAuthError('Error al inicializar autenticación');
      } finally {
        setLoading(false);
      }
    };

    getInitialSession();

    // Listener para cambios de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[Auth] Auth state change:', event, session ? 'HAS_SESSION' : 'NO_SESSION');
      
      // Solo manejar eventos importantes
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        handleAuthChange(session);
      }
    });

    // Cleanup
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, pass: string): Promise<void> => {
    setLoading(true);
    setAuthError(null);
    
    try {
      const { error } = await supabase.auth.signInWithPassword({ 
        email, 
        password: pass 
      });
      
      if (error) throw error;
      
      console.log('[Auth] Login successful');
    } catch (error: any) {
      console.error('[Auth] Login error:', error);
      setAuthError(error.message || 'Error al iniciar sesión');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signup = async (email: string, pass: string, nickname: string): Promise<void> => {
    setLoading(true);
    setAuthError(null);
    
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password: pass,
        options: {
          data: { 
            nickname: nickname,
          }
        }
      });

      if (error) throw error;
      
      console.log('[Auth] Signup successful');
    } catch (error: any) {
      console.error('[Auth] Signup error:', error);
      setAuthError(error.message || 'Error al registrarse');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    setLoading(true);
    
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      console.log('[Auth] Logout successful');
    } catch (error: any) {
      console.error('[Auth] Logout error:', error);
      setAuthError(error.message || 'Error al cerrar sesión');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      currentUser, 
      session, 
      loading, 
      login, 
      logout, 
      signup,
      authError 
    }}>
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