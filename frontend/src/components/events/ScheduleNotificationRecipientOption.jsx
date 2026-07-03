export default function ScheduleNotificationRecipientOption({ id, inputId, label, typeLabel, checked, onToggle }) {
  return (
    <div className="flex items-start gap-2 border border-edge/60 px-2.5 py-2 text-xs text-dim">
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-current"
        checked={checked}
        onChange={(event) => onToggle(id, event.target.checked)}
      />
      <span>
        <label htmlFor={inputId} className="block font-medium text-ink">
          {label}
        </label>
        <span className="text-ghost">{typeLabel}</span>
      </span>
    </div>
  );
}
