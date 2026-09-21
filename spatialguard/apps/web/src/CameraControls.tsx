import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { heading, type CameraChange } from "@twinforge/spatial-view/cameraGlyph";
import type { Camera } from "../../../../packages/sdk-typescript";

// Each committed change publishes a new geometry revision, so sliders report while
// dragging and only send the value once the owner lets go.
function Slider({
  label,
  unit,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onChange(draft);
  };
  return (
    <label className="camera-slider">
      <span>{label}</span>
      <output>
        {step < 1 ? draft.toFixed(1) : Math.round(draft)}
        {unit}
      </output>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  );
}

export default function CameraControls({
  camera,
  disabled,
  onChange,
  onRemove,
}: {
  camera: Camera;
  disabled: boolean;
  onChange: (change: CameraChange) => void;
  onRemove: () => void;
}) {
  return (
    <div className="camera-controls">
      <Slider
        label="Aim"
        unit="°"
        value={heading(camera.heading_degrees)}
        min={0}
        max={359}
        disabled={disabled}
        onChange={(heading_degrees) => onChange({ heading_degrees })}
      />
      <p className="camera-lens">
        {Math.round(camera.fov_degrees)}° field of view · fixed by the Ring lens
      </p>
      <Slider
        label="Range"
        unit=" m"
        value={camera.range_m}
        min={0.5}
        max={20}
        step={0.5}
        disabled={disabled}
        onChange={(range_m) => onChange({ range_m })}
      />
      <div className="button-row">
        <button
          disabled={disabled}
          onClick={() =>
            onChange({ heading_degrees: heading(camera.heading_degrees + 15) })
          }
        >
          Turn left
        </button>
        <button
          disabled={disabled}
          onClick={() =>
            onChange({ heading_degrees: heading(camera.heading_degrees - 15) })
          }
        >
          Turn right
        </button>
        <button className="danger" disabled={disabled} onClick={onRemove}>
          <Trash2 size={16} />
          Remove
        </button>
      </div>
    </div>
  );
}
