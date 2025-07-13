
import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AppRoute } from '../types';
import { APP_NAME } from '../constants';
import { Puzzle } from 'lucide-react'; // Icon for the game

const Navbar: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate(AppRoute.Auth);
  };
  
  const navLinkClasses = "px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-700 hover:text-white transition-colors";
  const activeNavLinkClasses = "bg-red-600 text-white";

  const isActive = (path: string) => location.pathname === path || location.hash === `#${path}`;


  return (
    <nav className="bg-gray-800 shadow-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link to={AppRoute.Home} className="flex-shrink-0 text-white text-xl font-bold">
              <span className="text-red-500">F1</span> {APP_NAME.split(' ')[1]} <span className="text-red-500">{APP_NAME.split(' ')[2]}</span>
            </Link>
          </div>
          <div className="hidden md:block">
            <div className="ml-10 flex items-baseline space-x-4">
              <Link to={AppRoute.Home} className={`${navLinkClasses} ${isActive(AppRoute.Home) ? activeNavLinkClasses : 'text-gray-300'}`}>Dashboard</Link>
              <Link to={AppRoute.MyTeam} className={`${navLinkClasses} ${isActive(AppRoute.MyTeam) ? activeNavLinkClasses : 'text-gray-300'}`}>Mi Equipo</Link>
              <Link to={AppRoute.Standings} className={`${navLinkClasses} ${isActive(AppRoute.Standings) ? activeNavLinkClasses : 'text-gray-300'}`}>Clasificaciones</Link>
              <Link to={AppRoute.Calendar} className={`${navLinkClasses} ${isActive(AppRoute.Calendar) ? activeNavLinkClasses : 'text-gray-300'}`}>Calendario</Link>
              <Link to={AppRoute.Rules} className={`${navLinkClasses} ${isActive(AppRoute.Rules) ? activeNavLinkClasses : 'text-gray-300'}`}>Reglas</Link>
              <Link to={AppRoute.DriverGuessGame} className={`${navLinkClasses} ${isActive(AppRoute.DriverGuessGame) ? activeNavLinkClasses : 'text-gray-300'} flex items-center`}>
                <Puzzle size={16} className="mr-1 text-yellow-400" /> Adivina Piloto
              </Link>
              {currentUser && (
                <Link to={AppRoute.Profile} className={`${navLinkClasses} ${isActive(AppRoute.Profile) ? activeNavLinkClasses : 'text-gray-300'}`}>Perfil</Link>
              )}
            </div>
          </div>
          <div className="hidden md:block">
            {currentUser ? (
              <button
                onClick={handleLogout}
                className="ml-4 px-3 py-2 rounded-md text-sm font-medium text-gray-300 hover:bg-red-700 hover:text-white transition-colors border border-red-600"
              >
                Cerrar Sesión
              </button>
            ) : (
              <Link
                to={AppRoute.Auth}
                className="ml-4 px-3 py-2 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
              >
                Iniciar Sesión
              </Link>
            )}
          </div>
          {/* Mobile menu button (optional, can be added later) */}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;