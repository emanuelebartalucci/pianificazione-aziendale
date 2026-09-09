import React from 'react';
import { 
  Folder, 
  Layers, 
  FileText, 
  FileSpreadsheet, 
  Image as ImageIcon, 
  Archive, 
  File, 
  X 
} from 'lucide-react';
import { 
  type AttachmentIconKey, 
  getFileTypeVisualProps, 
  openAttachedPath 
} from '../services/todoService';

export function AttachmentTypeIcon({ 
  iconKey, 
  className = "w-4 h-4" 
}: { 
  iconKey: AttachmentIconKey; 
  className?: string;
}) {
  switch (iconKey) {
    case 'folder':
      return <Folder className={className} />;
    case 'cad':
      return <Layers className={className} />;
    case 'pdf':
      return <FileText className={className} />;
    case 'excel':
      return <FileSpreadsheet className={className} />;
    case 'word':
      return <FileText className={className} />;
    case 'image':
      return <ImageIcon className={className} />;
    case 'archive':
      return <Archive className={className} />;
    case 'generic':
    default:
      return <File className={className} />;
  }
}

export interface AttachmentBadgeProps {
  percorso: string;
  nome?: string;
  tipo?: 'file' | 'cartella';
  estensione?: string;
  onRemove?: () => void;
  clickable?: boolean;
}

export function AttachmentBadge({
  percorso,
  nome,
  tipo,
  estensione,
  onRemove,
  clickable = true
}: AttachmentBadgeProps) {
  const visual = getFileTypeVisualProps(tipo, estensione);
  const displayName = nome || percorso.split(/[\\/]/).filter(Boolean).pop() || percorso;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (clickable) {
      openAttachedPath(percorso);
    }
  };

  return (
    <div
      onClick={clickable ? handleClick : undefined}
      title={`📁 Percorso: ${percorso}\nClicca per aprire direttamente in Windows`}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold border transition-all ${visual.bg} ${visual.text} ${visual.border} ${
        clickable ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer active:translate-y-0 active:scale-[0.98]' : ''
      }`}
    >
      <span className="shrink-0">
        <AttachmentTypeIcon iconKey={visual.iconKey} className="w-3.5 h-3.5" />
      </span>
      <span className="max-w-[200px] sm:max-w-[280px] truncate font-semibold" title={displayName}>
        {displayName}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-1 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-gray-500 hover:text-red-600 transition cursor-pointer"
          title="Rimuovi collegamento"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export default AttachmentBadge;
