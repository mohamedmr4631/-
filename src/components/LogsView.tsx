import { useMemo, useState } from 'react';
import { Download, History, Search } from 'lucide-react';
import type { AttendanceAction, AttendanceLog } from '../types/attendance';
import {
  exportLogsToCsv,
  formatDateTimeAr,
  getActionLabelAr,
} from '../utils/crypto';

interface LogsViewProps {
  logs: AttendanceLog[];
  logsLoading: boolean;
  isAdmin: boolean;
}

export function LogsView({ logs, logsLoading, isAdmin }: LogsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState<'all' | AttendanceAction>('all');

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((log) => {
      if (actionFilter !== 'all' && log.action !== actionFilter) return false;
      if (q && !log.employeeName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, searchQuery, actionFilter]);

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-teal-700" />
            <h1 className="text-lg font-bold text-slate-900">
              {isAdmin ? 'سجل الحركات الكامل' : 'سجل حركات هذه الجلسة'}
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {isAdmin
              ? 'آخر 50 حركة حضور وانصراف واستراحة على مستوى الفرع'
              : 'الحركات المسجلة من حسابك الحالي (آخر 50 حركة)'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث باسم الموظف..."
              className="h-9 pr-8 pl-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:bg-white focus:border-teal-700"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: 'all', label: 'الكل' },
                { id: 'check_in', label: 'دخول' },
                { id: 'break_start', label: 'بدء بريك' },
                { id: 'break_end', label: 'عودة' },
                { id: 'check_out', label: 'خروج' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActionFilter(item.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  actionFilter === item.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={filteredLogs.length === 0}
            onClick={() => exportLogsToCsv(filteredLogs)}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>تصدير CSV</span>
          </button>
        </div>
      </div>

      {logsLoading ? (
        <div className="p-5 space-y-3">
          {[1, 2, 3, 4].map((idx) => (
            <div key={idx} className="h-10 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="p-12 text-center text-sm text-slate-500">
          لا توجد حركات مسجلة مطابقة للبحث الحالي.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">الموظف</th>
                <th className="py-3 px-4">الحركة</th>
                <th className="py-3 px-4">الفرع / GPS</th>
                <th className="py-3 px-4">الوقت والتاريخ</th>
                <th className="py-3 px-4">عنوان IP</th>
                <th className="py-3 px-4">الجهاز</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4 font-semibold text-slate-900">
                    {log.employeeName}
                  </td>
                  <td className="py-3 px-4 text-xs font-semibold">
                    <span
                      className={
                        log.action === 'check_in'
                          ? 'text-emerald-700'
                          : log.action === 'check_out'
                            ? 'text-red-700'
                            : 'text-amber-700'
                      }
                    >
                      {getActionLabelAr(log.action)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700 tabular-nums">
                    <div>{log.branchName || '—'}</div>
                    {typeof log.distanceMeters === 'number' && (
                      <div className="text-[11px] text-teal-700 font-medium">
                        المسافة: {log.distanceMeters}م
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700">
                    {log.timestamp ? formatDateTimeAr(log.timestamp.toDate()) : '—'}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600" dir="ltr">
                    {log.ip || '—'}
                  </td>
                  <td
                    className="py-3 px-4 font-mono tabular-nums text-xs text-slate-500 max-w-[140px] truncate"
                    dir="ltr"
                    title={log.deviceId}
                  >
                    {log.deviceId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
