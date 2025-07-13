
import React from 'react';
import { F1Driver, F1Team } from '../types';

interface DriverSelectItemProps {
  driver: F1Driver;
  team: F1Team | undefined;
  isSelected: boolean;
  onSelect: (driverId: string) => void;
  disabled?: boolean;
}

const DriverSelectItem: React.FC<DriverSelectItemProps> = ({ driver, team, isSelected, onSelect, disabled }) => {
  return (
    <button
      onClick={() => onSelect(driver.id)}
      disabled={disabled && !isSelected}
      className={`w-full p-3 rounded-lg text-left transition-all duration-200 border-2
                  ${isSelected ? 'border-red-500 bg-red-900/50 ring-2 ring-red-500' : 'border-gray-700 bg-gray-800 hover:border-red-600'}
                  ${disabled && !isSelected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <div className="flex items-center space-x-3">
        {driver.headshotUrl && (
          <img src={driver.headshotUrl} alt={driver.name} className="w-12 h-12 rounded-full object-cover border-2 border-gray-600" />
        )}
        <div>
          <p className={`font-semibold text-lg ${isSelected ? 'text-red-400' : 'text-white'}`}>{driver.name} <span className="text-gray-400 text-sm">#{driver.number}</span></p>
          <p className={`text-sm ${team ? team.color.replace('bg-', 'text-') : 'text-gray-400'} ${isSelected ? 'opacity-90' : 'opacity-70'}`}>
            {team?.name || 'Equipo Desconocido'}
          </p>
        </div>
      </div>
    </button>
  );
};

export default DriverSelectItem;
    