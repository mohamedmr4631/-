import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  details: string | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '', details: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = 'حدث خطأ غير متوقع أثناء تشغيل النظام.';
    let details: string | null = error.message;

    try {
      const parsed = JSON.parse(error.message) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed.error && parsed.operationType) {
        readable = 'تعذر إتمام العملية بسبب قيود الصلاحيات أو الاتصال بقاعدة البيانات.';
        details = `${parsed.operationType.toUpperCase()} (${parsed.path ?? '—'}): ${parsed.error}`;
      }
    } catch {
      // Non-JSON runtime error
    }

    return {
      hasError: true,
      message: readable,
      details,
    };
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '', details: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" dir="rtl">
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-8">
            <div className="flex items-center gap-3 text-red-700 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-bold">تعذر متابعة الجلسة</h1>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed mb-4">{this.state.message}</p>
            {this.state.details && (
              <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs font-mono text-slate-600 overflow-x-auto mb-6 text-left" dir="ltr">
                {this.state.details}
              </pre>
            )}
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>إعادة تحميل النظام</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
