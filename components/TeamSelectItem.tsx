
import React from 'react';
import { F1Team } from '../types';

interface TeamSelectItemProps {
  team: F1Team;
  isSelected: boolean;
  onSelect: (teamId: string) => void;
  disabled?: boolean;
}

const TeamSelectItem: React.FC<TeamSelectItemProps> = ({ team, isSelected, onSelect, disabled }) => {
  return (
    <button
      onClick={() => onSelect(team.id)}
      disabled={disabled && !isSelected}
      className={`w-full p-4 rounded-lg text-left transition-all duration-200 border-2
                  ${isSelected ? 'border-red-500 bg-red-900/50 ring-2 ring-red-500' : `border-gray-700 bg-gray-800 hover:border-red-600`}
                  ${disabled && !isSelected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <div className="flex items-center space-x-4">
        {team.logoUrl && (
          <img src={team.logoUrl} alt={team.name} className={`w-10 h-10 object-contain p-1 rounded ${team.color}`} />
        )}
        <div>
          <p className={`font-semibold text-lg ${isSelected ? 'text-red-400' : 'text-white'}`}>{team.name}</p>
        </div>
      </div>
    </button>
  );
};

export default TeamSelectItem;
    