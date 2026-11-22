import { CheckCircle2, Coffee, MinusCircle } from 'lucide-react';
import type { EmployeeStatus } from '../types/attendance';

export function StatusText({ status }: { status: EmployeeStatus }) {
  if (status === 'working') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>على رأس العمل</span>
      </span>
    );
  }

  if (status === 'break') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap">
        <Coffee className="w-3.5 h-3.5 shrink-0" />
        <span>في بريك</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap">
      <MinusCircle className="w-3.5 h-3.5 shrink-0" />
      <span>خارج الدوام</span>
    </span>
  );
}
