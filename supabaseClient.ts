import { createClient } from '@supabase/supabase-js';
import { Database } from './types_db';
import dotenv from 'dotenv';


// Verificar que las variables de entorno existan
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables');
}

// Configuración del cliente con opciones de persistencia
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Configuración de persistencia de sesión
    storage: localStorage, // o sessionStorage si prefieres
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    
    // Configuración adicional para evitar problemas de sesión
    storageKey: 'supabase.auth.token',
    
    // Configuración de cookies para mejor persistencia
    flowType: 'pkce'
  },
  
  // Configuración global del cliente
  global: {
    headers: {
      'X-Client-Info': 'my-app'
    }
  }
});

// Función para verificar el estado de la sesión
export const checkSession = async () => {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('Error checking session:', error);
      return null;
    }
    return session;
  } catch (error) {
    console.error('Session check failed:', error);
    return null;
  }
};

// Función para manejar cambios de estado de autenticación
export const onAuthStateChange = (callback: (event: string, session: any) => void) => {
  return supabase.auth.onAuthStateChange(callback);
};

// Función para cerrar sesión correctamente
export const signOut = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error signing out:', error);
    }
  } catch (error) {
    console.error('Sign out failed:', error);
  }
};
