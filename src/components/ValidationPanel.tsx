import { useMemo } from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useStore } from '../store/store';
import { runValidations } from '../lib/validation';
import { Modal } from './ui';

export default function ValidationPanel({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const select = useStore((s) => s.select);
  const rules = useMemo(() => runValidations(project), [project]);

  return (
    <Modal title="Validaciones" onClose={onClose} wide>
      <div className="space-y-3">
        {rules.map((rule) => {
          const Icon = rule.ok ? CheckCircle2 : rule.info ? Info : AlertCircle;
          const color = rule.ok ? 'text-green-600' : rule.info ? 'text-blue-500' : 'text-red-500';
          return (
            <div key={rule.key} className="border border-slate-200 rounded-md">
              <div className="flex items-center gap-2 px-3 py-2">
                <Icon size={16} className={color} />
                <span className="text-sm font-medium text-slate-700 flex-1">{rule.title}</span>
                {!rule.ok && (
                  <span className={`text-xs font-semibold ${color}`}>{rule.count}</span>
                )}
              </div>
              {rule.items.length > 0 && (
                <div className="border-t border-slate-100 max-h-40 overflow-y-auto scroll-thin">
                  {rule.items.map((item, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (item.fieldId) {
                          select({ kind: 'field', id: item.fieldId });
                          onClose();
                        }
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex justify-between gap-2 border-b border-slate-50 last:border-0"
                    >
                      <span className="font-mono text-slate-600 truncate">{item.label}</span>
                      <span className="text-slate-400 shrink-0">{item.detail}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
