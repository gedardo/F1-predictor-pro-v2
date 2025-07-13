import React from 'react';
import { LetterState } from '../../types';

interface KeyboardKeyProps {
  value: string;
  state?: LetterState;
  onClick: (key: string) => void;
  isLarge?: boolean;
}

const KeyboardKey: React.FC<KeyboardKeyProps> = ({ value, state = 'neutral', onClick, isLarge = false }) => {
  const stateClasses: Record<LetterState, string> = {
    correct: 'bg-green-600 hover:bg-green-500 text-white',
    present: 'bg-yellow-500 hover:bg-yellow-400 text-white',
    absent: 'bg-gray-600 hover:bg-gray-500 text-gray-300',
    neutral: 'bg-gray-700 hover:bg-gray-600 text-gray-200',
    empty: '' // Should not be used for keyboard
  };

  const baseClasses = `flex items-center justify-center rounded font-semibold uppercase cursor-pointer transition-colors duration-150 ease-in-out select-none`;
  const sizeClasses = isLarge ? 'p-3 text-sm min-w-[44px]' : 'p-2.5 text-xs sm:text-sm min-w-[32px] sm:min-w-[40px]';

  return (
    <button
      className={`${baseClasses} ${sizeClasses} ${stateClasses[state]}`}
      onClick={() => onClick(value)}
      aria-label={`Tecla ${value}`}
    >
      {value === 'Backspace' ? (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75L14.25 12m0 0L12 14.25m2.25-2.25L18 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      ) : value}
    </button>
  );
};

export default KeyboardKey;