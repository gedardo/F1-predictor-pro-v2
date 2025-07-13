
import React from 'react';
import { F1Driver } from '../types';
import { useData } from '../contexts/DataContext';

interface PredictionInputProps<T> {
  label: string;
  options: F1Driver[];
  value: T; // Can be string | null for single selection, or (string | null)[] for multiple
  onChange: (value: T) => void;
  maxSelections?: number; // For Top-N style selections
  allowNull?: boolean;
  disabled?: boolean;
}

const PredictionInput = <T extends string | null | (string | null)[] | undefined,>({
  label,
  options,
  value,
  onChange,
  maxSelections = 1,
  allowNull = true,
  disabled = false,
}: PredictionInputProps<T>): React.ReactElement => {
  const { getTeamById, getDriverById } = useData();

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>, index?: number) => {
    const selectedDriverId = e.target.value === "null" ? null : e.target.value;
    if (Array.isArray(value) && typeof index === 'number') {
      const newValue = [...value] as (string | null)[];
      newValue[index] = selectedDriverId;
      onChange(newValue as T);
    } else {
      onChange(selectedDriverId as T);
    }
  };
  
  const renderSelect = (currentValue: string | null, idx?: number) => {
    const driverDetails = currentValue ? getDriverById(currentValue) : null;
    const teamDetails = driverDetails ? getTeamById(driverDetails.teamId) : null;
    const selectId = `prediction-${label.toLowerCase().replace(/\s/g, '-')}${idx !== undefined ? `-${idx}` : ''}`;

    return (
      <div className="relative">
        <select
          id={selectId}
          value={currentValue ?? "null"}
          onChange={(e) => handleSelectChange(e, idx)}
          disabled={disabled}
          className={`w-full p-3 pr-10 bg-gray-700 border border-gray-600 rounded-md shadow-sm text-white focus:ring-red-500 focus:border-red-500 appearance-none ${
            teamDetails ? teamDetails.color.replace('bg-', 'border-l-4 border-') : 'border-l-4 border-gray-500'
          }`}
        >
          {allowNull && <option value="null">-- Sin Seleccionar --</option>}
          {options.map(driver => (
            <option key={driver.id} value={driver.id}>
              {driver.name} (#{driver.number}) - {getTeamById(driver.teamId)?.name || 'N/A'}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9l4-4 4 4m0 6l-4 4-4-4"></path></svg>
        </div>
      </div>
    );
  };


  return (
    <div className="mb-6 p-4 bg-gray-800 rounded-lg shadow">
      <label className="block text-lg font-semibold text-red-400 mb-3">{label}</label>
      {Array.isArray(value) && maxSelections > 1 ? (
        <div className="space-y-3">
          {value.map((val, idx) => (
             <div key={idx} className="flex items-center space-x-2">
               <span className="text-gray-300 font-medium w-8 text-center">{idx + 1}.</span>
               {renderSelect(val, idx)}
             </div>
          ))}
        </div>
      ) : (
        renderSelect(value as string | null)
      )}
    </div>
  );
};

export default PredictionInput;
    