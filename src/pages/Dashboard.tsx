import { Briefcase, Calendar, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const navigate = useNavigate();

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto mt-10">
        <div 
          onClick={() => navigate('/commesse')} 
          className="bg-white p-8 rounded-2xl shadow-lg border hover:shadow-xl hover:-translate-y-1 transition-all text-center cursor-pointer group"
        >
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-blue-600 group-hover:text-white transition-colors">
            <Briefcase className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-800">Pianificazione Commesse</h2>
        </div>
        
        <div 
          onClick={() => navigate('/ferie')} 
          className="bg-white p-8 rounded-2xl shadow-lg border hover:shadow-xl hover:-translate-y-1 transition-all text-center cursor-pointer group"
        >
          <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-green-600 group-hover:text-white transition-colors">
            <Calendar className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-800">Piano Ferie</h2>
        </div>

        <div 
          onClick={() => navigate('/impostazioni')} 
          className="bg-white p-8 rounded-2xl shadow-lg border hover:shadow-xl hover:-translate-y-1 transition-all text-center cursor-pointer group"
        >
          <div className="w-16 h-16 bg-gray-100 text-gray-600 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-gray-800 group-hover:text-white transition-colors">
            <Settings className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-800">Impostazioni Admin</h2>
        </div>
      </div>
    </div>
  );
}
