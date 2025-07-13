
import React from 'react';
import { APP_NAME } from '../constants';

const Footer: React.FC = () => {
  return (
    <footer className="bg-gray-800 text-gray-400 py-8 mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <p>&copy; {new Date().getFullYear()} {APP_NAME}. Todos los derechos reservados.</p>
        <p className="text-xs mt-1">
          Design by Gerardo Navarro.
        </p>
        <div className="mt-4 flex justify-center space-x-4">
          <a href="#" className="hover:text-red-500 transition-colors">Política de Privacidad</a>
          <a href="#" className="hover:text-red-500 transition-colors">Términos de Servicio</a>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
    