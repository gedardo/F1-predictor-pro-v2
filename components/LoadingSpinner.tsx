
import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = 'md', message }) => {
  const sizeClasses = {
    sm: 'w-6 h-6 border-2',
    md: 'w-12 h-12 border-4',
    lg: 'w-20 h-20 border-[6px]',
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-2 my-8">
      <div 
        className={`${sizeClasses[size]} border-red-500 border-t-transparent rounded-full animate-spin`}
      ></div>
      {message && <p className="text-gray-300 text-sm animate-pulse">{message}</p>}
    </div>
  );
};

export default LoadingSpinner;
    