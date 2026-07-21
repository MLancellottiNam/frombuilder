import React from 'react';

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400 mt-0.5">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none disabled:bg-slate-100 disabled:text-slate-400';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 mb-2 text-sm text-slate-700 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      {label}
    </label>
  );
}

export function Button({
  children,
  variant = 'default',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger' }) {
  const base =
    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const variants: Record<string, string> = {
    default: 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50',
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    ghost: 'text-slate-500 hover:bg-slate-100',
    danger: 'text-red-600 hover:bg-red-50',
  };
  return (
    <button {...props} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
  size,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  size?: 'default' | 'wide' | 'full';
}) {
  const width = size === 'full' ? 'max-w-6xl' : size === 'wide' || wide ? 'max-w-3xl' : 'max-w-lg';
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={`bg-white rounded-lg shadow-xl w-full ${width} max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ×
          </button>
        </div>
        <div className="p-4 overflow-y-auto scroll-thin">{children}</div>
      </div>
    </div>
  );
}
