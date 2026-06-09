import { AlertTriangle, Info } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Conferma',
  cancelText = 'Annulla',
  type = 'danger',
  onConfirm,
  onCancel
}: ConfirmModalProps) {
  if (!isOpen) return null;

  // Icona e colori in base al tipo di conferma
  const getStyle = () => {
    switch (type) {
      case 'danger':
        return {
          icon: <AlertTriangle className="w-8 h-8 text-red-600" />,
          iconBg: 'bg-red-100',
          btnClass: 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
        };
      case 'warning':
        return {
          icon: <AlertTriangle className="w-8 h-8 text-amber-600" />,
          iconBg: 'bg-amber-100',
          btnClass: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500'
        };
      case 'info':
      default:
        return {
          icon: <Info className="w-8 h-8 text-indigo-600" />,
          iconBg: 'bg-indigo-100',
          btnClass: 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500'
        };
    }
  };

  const { icon, iconBg, btnClass } = getStyle();

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      {/* Card contenitore */}
      <div 
        className="bg-white rounded-[2rem] shadow-2xl max-w-md w-full border border-gray-100 p-8 flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Cerchio icona */}
        <div className={`p-4 rounded-2xl ${iconBg} mb-4 flex items-center justify-center`}>
          {icon}
        </div>

        {/* Titolo e Testo */}
        <h3 className="text-xl font-extrabold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm font-medium text-gray-500 leading-relaxed mb-6 px-2">{message}</p>

        {/* Pulsanti */}
        <div className="flex w-full gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 hover:bg-gray-50 active:scale-95 transition"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 py-3 px-4 rounded-xl text-white text-sm font-bold active:scale-95 transition focus:outline-none focus:ring-2 focus:ring-offset-2 ${btnClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
