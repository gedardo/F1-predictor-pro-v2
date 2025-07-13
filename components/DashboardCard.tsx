
import React, { ReactNode } from 'react';

interface DashboardCardProps {
  title: string;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}

const DashboardCard: React.FC<DashboardCardProps> = ({ title, children, className = '', icon }) => {
  return (
    <div className={`bg-gray-800 p-6 rounded-lg shadow-xl transform hover:scale-105 transition-transform duration-300 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-semibold text-red-500">{title}</h3>
        {icon && <div className="text-red-500 text-2xl">{icon}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
};

export default DashboardCard;
    