
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from './LoadingSpinner';

interface AuthFormProps {
  isLogin: boolean;
  setIsLogin: (isLogin: boolean) => void;
}

const AuthForm: React.FC<AuthFormProps> = ({ isLogin, setIsLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState(''); // New state for nickname
  const [error, setError] = useState('');
  const { login, signup, loading } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isLogin) {
      if (password !== confirmPassword) {
        setError('Las contraseñas no coinciden.');
        return;
      }
      if (!nickname.trim() || nickname.trim().length < 3) {
        setError('El Nick de Usuario debe tener al menos 3 caracteres.');
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(nickname.trim())) {
        setError('El Nick de Usuario solo puede contener letras, números y guiones bajos (_).');
        return;
      }
    }

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await signup(email, password, nickname.trim());
      }
    } catch (err: any) {
      if (err.message && err.message.toLowerCase().includes('email not confirmed')) {
        setError('Tu correo electrónico aún no ha sido confirmado. Por favor, revisa tu bandeja de entrada (y la carpeta de spam) para encontrar el correo de confirmación y haz clic en el enlace. Si no lo encuentras, puedes intentar registrarte de nuevo para recibir otro correo.');
      } else if (err.message && err.message.toLowerCase().includes('user already registered')) {
        setError('Este correo electrónico ya está registrado. Por favor, inicia sesión o utiliza un correo diferente.');
      } else if (err.message && (err.message.toLowerCase().includes('duplicate key value violates unique constraint "perfiles_usuarios_nickname_key"') || err.message.toLowerCase().includes('nickname already taken'))){
        setError('Este Nick de Usuario ya está en uso. Por favor, elige otro.');
      }
       else {
        setError(err.message || 'Error de autenticación.');
      }
    }
  };

  if (loading && (isLogin || (!isLogin && nickname))) { // Ensure loading spinner shows during signup process too
    return <LoadingSpinner message={isLogin ? "Iniciando sesión..." : "Registrando..."} />;
  }

  return (
    <div className="w-full max-w-md p-8 space-y-6 bg-gray-800 rounded-xl shadow-2xl">
      <h2 className="text-3xl font-bold text-center text-white">
        {isLogin ? 'Iniciar Sesión' : 'Crear Cuenta'}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        {!isLogin && (
          <div>
            <label htmlFor="nickname" className="block text-sm font-medium text-gray-300">
              Nick de Usuario (mín. 3 caracteres, solo letras, números y _)
            </label>
            <input
              id="nickname"
              name="nickname"
              type="text"
              autoComplete="username"
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-white"
            />
          </div>
        )}
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-300">
            Correo Electrónico
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-white"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-300">
            Contraseña (mín. 6 caracteres)
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-white"
          />
        </div>
        {!isLogin && (
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-300">
              Confirmar Contraseña
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm text-white"
            />
          </div>
        )}
        {error && <p className="text-sm text-red-400 bg-red-900/30 p-3 rounded-md">{error}</p>}
        <div>
          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 focus:ring-offset-gray-800 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Procesando...' : (isLogin ? 'Iniciar Sesión' : 'Registrarse')}
          </button>
        </div>
      </form>
      <p className="text-sm text-center text-gray-400">
        {isLogin ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
        <button
          onClick={() => {
            setIsLogin(!isLogin);
            setError(''); 
            setNickname(''); // Clear nickname field when switching
          }}
          className="ml-1 font-medium text-red-500 hover:text-red-400"
        >
          {isLogin ? 'Regístrate' : 'Inicia Sesión'}
        </button>
      </p>
    </div>
  );
};

export default AuthForm;
