import { LogOut } from 'lucide-react';
import type { AppTab } from '../types/attendance';
import { PWAInstallButton } from './PWAInstallButton';

interface TopBarProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  isAdmin: boolean;
  username: string;
  pendingBreakCount: number;
  onSignOut: () => void;
}

export function TopBar({
  activeTab,
  onTabChange,
  isAdmin,
  username,
  pendingBreakCount,
  onSignOut,
}: TopBarProps) {
  const adminLabel =
    pendingBreakCount > 0 ? `لوحة المدير (${pendingBreakCount})` : 'لوحة المدير';

  const navItems: { id: AppTab; label: string; visible: boolean }[] = [
    { id: 'employee', label: 'بوابة الموظف', visible: true },
    { id: 'logs', label: 'سجل الحركات', visible: true },
    { id: 'admin', label: adminLabel, visible: isAdmin },
  ];

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 pt-safe">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-6 md:gap-8">
        {/* Zone 1: Single-element brand wordmark */}
        <button
          type="button"
          onClick={() => onTabChange('employee')}
          className="text-sm sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 hover:text-teal-800 transition-colors min-h-[44px] flex items-center"
        >
          نظام البصمة السحابي
        </button>

        {/* Zone 2: Clean single-line navigation links */}
        <nav
          className="flex items-center gap-3 sm:gap-6 overflow-x-auto no-scrollbar"
          aria-label="التنقل الرئيسي"
        >
          {navItems
            .filter((item) => item.visible)
            .map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  className={`min-h-[44px] py-2 text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors tabular-nums flex items-center ${
                    isActive
                      ? 'border-teal-700 text-teal-800 font-semibold'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
        </nav>

        {/* Zone 3: Primary account and install actions */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <PWAInstallButton />
          <span className="hidden lg:inline-block text-xs font-semibold text-slate-700 max-w-[140px] truncate">
            {username}
          </span>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-2.5 sm:px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">خروج</span>
          </button>
        </div>
      </div>
    </header>
  );
}
