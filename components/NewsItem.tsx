
import React from 'react';
import { NewsArticle } from '../types';

interface NewsItemProps {
  article: NewsArticle;
}

const NewsItem: React.FC<NewsItemProps> = ({ article }) => {
  return (
    <div className="p-3 bg-gray-700 rounded-md hover:bg-gray-600 transition-colors">
      <h4 className="text-md font-semibold text-gray-100">{article.title}</h4>
      {article.url && (
        <a href={article.url} target="_blank" rel="noopener noreferrer" className="text-xs text-red-400 hover:text-red-300">
          Leer más
        </a>
      )}
       {article.source && <p className="text-xs text-gray-400">Fuente: {article.source}</p>}
    </div>
  );
};

export default NewsItem;
    