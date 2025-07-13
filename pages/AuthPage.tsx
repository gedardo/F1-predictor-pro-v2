
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthForm from '../components/AuthForm';
import { useAuth } from '../contexts/AuthContext';
import { AppRoute } from '../types';
import { APP_NAME } from '../constants';

const AuthPage: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (currentUser) {
      navigate(AppRoute.Home);
    }
  }, [currentUser, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900 py-12 px-4 sm:px-6 lg:px-8 pattern-bg">
      <style>
        {`
          .pattern-bg {
            background-image: 
              radial-gradient(circle at top left, rgba(229, 62, 62, 0.05), transparent 30%),
              radial-gradient(circle at bottom right, rgba(59, 130, 246, 0.05), transparent 30%);
            background-size: 100px 100px;
          }
        `}
      </style>
      <div className="mb-8 text-center">
         <h1 className="text-5xl font-extrabold text-white">
            Bienvenido a <span className="text-red-500">{APP_NAME}</span>
        </h1>
        <p className="mt-2 text-lg text-gray-300">Tu portal de predicciones de Fórmula 1.</p>
      </div>
      <AuthForm isLogin={isLogin} setIsLogin={setIsLogin} />
    </div>
  );
};

export default AuthPage;
    