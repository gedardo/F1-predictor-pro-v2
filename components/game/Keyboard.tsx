import React from 'react';
import KeyboardKey from './KeyboardKey';
import { LetterState } from '../../types';

interface KeyboardProps {
  onKeyPress: (key: string) => void;
  letterStates: Record<string, LetterState>;
}

const Keyboard: React.FC<KeyboardProps> = ({ onKeyPress, letterStates }) => {
  const rows = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ñ'],
    ['Enter', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Backspace'],
  ];

  return (
    <div className="flex flex-col items-center space-y-1.5 sm:space-y-2 mt-6">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex justify-center space-x-1 sm:space-x-1.5">
          {row.map((key) => (
            <KeyboardKey
              key={key}
              value={key}
              state={letterStates[key] || 'neutral'}
              onClick={onKeyPress}
              isLarge={key === 'Enter' || key === 'Backspace'}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

export default Keyboard;