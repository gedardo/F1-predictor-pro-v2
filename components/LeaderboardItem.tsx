
import React from 'react';
import { UserCircle } from 'lucide-react';

interface LeaderboardItemProps {
  rank: number;
  name: string; // This will be the nickname
  points: number;
  isCurrentUser?: boolean;
  avatarUrl?: string | null;
}

const LeaderboardItem: React.FC<LeaderboardItemProps> = ({ rank, name, points, isCurrentUser, avatarUrl }) => {
  return (
    <li className={`flex justify-between items-center p-3 rounded-md ${isCurrentUser ? 'bg-red-700 text-white shadow-lg ring-2 ring-red-500' : 'bg-gray-700 hover:bg-gray-600'} transition-colors`}>
      <div className="flex items-center">
        <span className={`font-bold w-8 text-center ${isCurrentUser ? 'text-yellow-300' : 'text-red-400'}`}>{rank}</span>
        {avatarUrl ? (
          <img src={avatarUrl} alt={name} className="w-8 h-8 rounded-full ml-3 mr-2 object-cover border border-gray-500"/>
        ) : (
          <UserCircle size={24} className={`ml-3 mr-2 ${isCurrentUser ? 'text-red-300' : 'text-gray-400'}`} />
        )}
        <span className="ml-1 truncate max-w-[150px] sm:max-w-xs" title={name}>{name}</span>
      </div>
      <span className={`font-semibold ${isCurrentUser ? 'text-yellow-300' : 'text-gray-200'}`}>{points} pts</span>
    </li>
  );
};

export default LeaderboardItem;
