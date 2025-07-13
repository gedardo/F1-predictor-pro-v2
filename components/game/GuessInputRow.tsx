
import React from 'react';
import { GameLetter, LetterState } from '../../types';

interface GuessInputRowProps {
  guess: GameLetter[];
  wordLength: number;
  isSubmitted: boolean; // To differentiate between an active input row and a submitted guess
}

const GuessInputRow: React.FC<GuessInputRowProps> = ({ guess, wordLength, isSubmitted }) => {
  const getBoxStyle = (state: LetterState, char: string): string => {
    let baseStyle = 'transition-all duration-500 ease-in-out ';
    if (isSubmitted && char) { // Apply reveal animation only to submitted, non-empty boxes
        // Could add a specific animation class here if defined, e.g., 'animate-reveal'
        // For now, relying on color transition
    }

    switch (state) {
      case 'correct':
        return baseStyle + 'bg-green-500 border-green-400 text-white transform scale-105'; 
      case 'present':
        return baseStyle + 'bg-yellow-500 border-yellow-400 text-white'; 
      case 'absent':
        return baseStyle + 'bg-gray-600 border-gray-500 text-white opacity-75'; 
      case 'empty': // Active input or not yet guessed
      default:
        return baseStyle + 'bg-gray-700/50 border-gray-600'; 
    }
  };

  const boxes = [];
  for (let i = 0; i < wordLength; i++) {
    const letter = guess[i];
    const char = letter ? letter.char : '';
    const state = letter ? letter.state : 'empty';
    
    boxes.push(
      <div
        key={i}
        className={`w-12 h-12 sm:w-14 sm:h-14 border-2 rounded-md flex items-center justify-center text-2xl sm:text-3xl font-bold uppercase ${getBoxStyle(state, char)}`}
        aria-label={`Letra ${i+1}${char ? `: ${char}, estado: ${state}` : ', vacía'}`}
        style={{transitionDelay: isSubmitted && char ? `${i * 75}ms` : '0ms' }} // Stagger animation for submitted rows
      >
        {char}
      </div>
    );
  }

  return <div className="flex justify-center space-x-1.5 sm:space-x-2">{boxes}</div>;
};

export default GuessInputRow;