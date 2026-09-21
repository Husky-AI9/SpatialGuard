import { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";

/** A heading you can edit in place. Commits on Enter, abandons on Escape. */
export default function RenameField({
  value,
  label,
  disabled,
  onRename,
}: {
  value: string;
  label: string;
  disabled: boolean;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const commit = () => {
    const name = draft.trim().slice(0, 100);
    setEditing(false);
    if (name && name !== value) onRename(name);
    else setDraft(value);
  };
  if (!editing)
    return (
      <span className="rename">
        <strong>{value}</strong>
        <button
          className="rename-start"
          aria-label={`Rename ${value}`}
          title={label}
          disabled={disabled}
          onClick={() => setEditing(true)}
        >
          <Pencil size={14} />
        </button>
      </span>
    );
  return (
    <span className="rename editing">
      <input
        ref={input}
        aria-label={label}
        maxLength={100}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(value);
            setEditing(false);
          }
        }}
        onBlur={commit}
      />
      <button aria-label="Save name" onMouseDown={(e) => e.preventDefault()} onClick={commit}>
        <Check size={14} />
      </button>
      <button
        aria-label="Cancel rename"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setDraft(value);
          setEditing(false);
        }}
      >
        <X size={14} />
      </button>
    </span>
  );
}
