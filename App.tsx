
import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import HomePage from './pages/HomePage';
import AuthPage from './pages/AuthPage';
import MyTeamPage from './pages/MyTeamPage';
import StandingsPage from './pages/StandingsPage';
import CalendarPage from './pages/CalendarPage';
import PredictionPage from './pages/PredictionPage';
import RulesPage from './pages/RulesPage';
import ProfilePage from './pages/ProfilePage';
import DriverGuessGamePage from './pages/DriverGuessGamePage';
import AdminRaceResultsPage from './pages/AdminRaceResultsPage';
import { useAuth } from './contexts/AuthContext';
import { AppRoute } from './types';
import LoadingSpinner from './components/LoadingSpinner';
import SupabaseQueryLogger from './components/SupabaseQueryLogger';

const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, adminOnly = false }) => {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return <div className="flex justify-center items-center min-h-screen"><LoadingSpinner message="Verificando sesión..."/></div>;
  }

  if (!currentUser) {
    return <Navigate to={AppRoute.Auth} replace />;
  }

  const isAdmin = currentUser?.email?.endsWith('@admin.example.com');

  if (adminOnly && !isAdmin && currentUser?.email !== 'admin@admin.ejemplo.com') { // Allow special admin through if they reach this via normal route for some reason
    return <Navigate to={AppRoute.Home} replace />;
  }

  return <>{children}</>;
};


const App: React.FC = () => {
  const { currentUser, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-900 text-gray-100 justify-center items-center">
        <LoadingSpinner message="Inicializando aplicación..." />
      </div>
    );
  }

  const isSpecialAdmin = currentUser?.email === 'admin@admin.ejemplo.com';

  return (
    <HashRouter>
      <ScrollToTop />
      <div className="flex flex-col min-h-screen bg-gray-900 text-gray-100">
        {!isSpecialAdmin && <Navbar />}
        <main className={`flex-grow ${isSpecialAdmin ? '' : 'pb-20'}`}>
          <Routes>
            {isSpecialAdmin ? (
              <Route path="*" element={<AdminRaceResultsPage />} />
            ) : (
              <>
                {/* Public Routes */}
                <Route path={AppRoute.Auth} element={<AuthPage />} />

                {/* Protected Routes */}
                <Route path={AppRoute.Home} element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
                <Route path={AppRoute.MyTeam} element={<ProtectedRoute><MyTeamPage /></ProtectedRoute>} />
                <Route path={AppRoute.Standings} element={<ProtectedRoute><StandingsPage /></ProtectedRoute>} />
                <Route path={AppRoute.Calendar} element={<ProtectedRoute><CalendarPage /></ProtectedRoute>} />
                <Route path={`${AppRoute.Prediction}/:raceId`} element={<ProtectedRoute><PredictionPage /></ProtectedRoute>} />
                <Route path={AppRoute.Rules} element={<ProtectedRoute><RulesPage /></ProtectedRoute>} />
                <Route path={AppRoute.Profile} element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
                <Route path={AppRoute.DriverGuessGame} element={<ProtectedRoute><DriverGuessGamePage /></ProtectedRoute>} />

                {/* Admin Routes (for other admins or if special admin navigates via link) */}
                <Route
                  path={AppRoute.AdminRaceResults}
                  element={<ProtectedRoute adminOnly={true}><AdminRaceResultsPage /></ProtectedRoute>}
                />

                <Route path="*" element={<NavigateToHomeOrAuth />} />
              </>
            )}
          </Routes>
        </main>
        {!isSpecialAdmin && <Footer />}
        <SupabaseQueryLogger />
      </div>
    </HashRouter>
  );
};

const NavigateToHomeOrAuth: React.FC = () => {
  const { currentUser, loading } = useAuth(); // No need for loading check here as App component handles initial authLoading
  if (loading) return <div className="flex justify-center items-center min-h-screen"><LoadingSpinner /></div>; // Should ideally not be hit if App handles authLoading
  return <Navigate to={currentUser ? AppRoute.Home : AppRoute.Auth} replace />;
};


export default App;
