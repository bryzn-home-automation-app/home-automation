import { useCallback, useEffect, useId, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { hsvToHex, type Hsv } from '../../utils/appColour';

/**
 * A colour wheel: a hue ring around a saturation/brightness square (HSV), drawn with
 * CSS gradients. Two handles, each a 44px slider you can tab to: the ring handle's
 * arrow keys turn the hue (1 degree, 10 with Shift or Page Up/Down), the square's
 * move saturation (left/right) and brightness (up/down) by 1% (10% with Shift).
 *
 * Dragging reports at most once per animation frame (`final` false), and once more
 * when the pointer lets go (`final` true), so a caller can paint every frame cheaply
 * and save only the end. Keys report `final` true.
 */
export interface ColourWheelProps {
  value: Hsv;
  onChange: (next: Hsv, final: boolean) => void;
  className?: string;
}

/** The ring's thickness in px (the square sits inside it). */
const RING = 30;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const HUE_NAMES: Array<[number, string]> = [
  [15, 'red'], [45, 'orange'], [70, 'yellow'], [160, 'green'], [195, 'cyan'], [255, 'blue'], [290, 'violet'], [335, 'magenta'], [360, 'red'],
];
const hueName = (h: number) => HUE_NAMES.find(([end]) => h < end)?.[1] ?? 'red';

type Drag = 'hue' | 'sv' | null;

export function ColourWheel({ value, onChange, className }: ColourWheelProps) {
  const id = useId();
  const wheel = useRef<HTMLDivElement>(null);
  const square = useRef<HTMLDivElement>(null);
  const hueKey = useRef<HTMLDivElement>(null);
  const svKey = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag>(null);
  const frame = useRef(0);
  const pending = useRef<{ x: number; y: number } | null>(null);
  // The latest value, so a frame computed after a re-render starts from it.
  const current = useRef(value);
  current.current = value;

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** The value under a pointer position, for the handle being dragged. */
  const valueAt = useCallback((x: number, y: number, mode: Exclude<Drag, null>): Hsv => {
    const v = current.current;
    if (mode === 'hue') {
      const r = wheel.current!.getBoundingClientRect();
      const angle = (Math.atan2(x - (r.left + r.width / 2), -(y - (r.top + r.height / 2))) * 180) / Math.PI;
      return { ...v, h: (angle + 360) % 360 };
    }
    const r = square.current!.getBoundingClientRect();
    return { ...v, s: clamp01((x - r.left) / r.width), v: clamp01(1 - (y - r.top) / r.height) };
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const sq = square.current!.getBoundingClientRect();
    const slop = 10;
    const inSquare = e.clientX >= sq.left - slop && e.clientX <= sq.right + slop && e.clientY >= sq.top - slop && e.clientY <= sq.bottom + slop;
    const r = wheel.current!.getBoundingClientRect();
    const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    const onRing = dist >= r.width / 2 - RING - 8 && dist <= r.width / 2 + 8;
    const mode: Drag = inSquare ? 'sv' : onRing ? 'hue' : null;
    if (!mode) return;
    e.preventDefault();
    drag.current = mode;
    wheel.current!.setPointerCapture?.(e.pointerId);
    (mode === 'hue' ? hueKey : svKey).current?.focus({ preventScroll: true });
    const next = valueAt(e.clientX, e.clientY, mode);
    current.current = next;
    onChange(next, false);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    pending.current = { x: e.clientX, y: e.clientY };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const p = pending.current;
      if (!p || !drag.current) return;
      const next = valueAt(p.x, p.y, drag.current);
      current.current = next;
      onChange(next, false);
    });
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const mode = drag.current;
    if (!mode) return;
    drag.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    pending.current = null;
    wheel.current!.releasePointerCapture?.(e.pointerId);
    const next = e.type === 'pointercancel' ? current.current : valueAt(e.clientX, e.clientY, mode);
    current.current = next;
    onChange(next, true);
  };

  const onHueKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const big = e.shiftKey ? 10 : 1;
    const steps: Record<string, number> = { ArrowRight: big, ArrowUp: big, ArrowLeft: -big, ArrowDown: -big, PageUp: 10, PageDown: -10 };
    let h: number;
    if (e.key in steps) h = (value.h + steps[e.key] + 360) % 360;
    else if (e.key === 'Home') h = 0;
    else if (e.key === 'End') h = 359;
    else return;
    e.preventDefault();
    onChange({ ...value, h: Math.round(h) % 360 }, true);
  };

  const onSvKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.shiftKey ? 0.1 : 0.01;
    let { s, v } = value;
    if (e.key === 'ArrowRight') s += d;
    else if (e.key === 'ArrowLeft') s -= d;
    else if (e.key === 'ArrowUp') v += d;
    else if (e.key === 'ArrowDown') v -= d;
    else if (e.key === 'PageUp') v += 0.1;
    else if (e.key === 'PageDown') v -= 0.1;
    else return;
    e.preventDefault();
    const round = (n: number) => Math.round(clamp01(n) * 100) / 100;
    onChange({ ...value, s: round(s), v: round(v) }, true);
  };

  const rad = (value.h * Math.PI) / 180;
  const hex = hsvToHex(value);
  const pureHue = hsvToHex({ h: value.h, s: 1, v: 1 });
  const s = Math.round(value.s * 100);
  const b = Math.round(value.v * 100);

  return (
    <div
      ref={wheel}
      className={`app-wheel ${className ?? ''}`}
      style={{ '--wheel-ring': `${RING}px` } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="app-wheel-ring" aria-hidden="true" />
      <div ref={square} className="app-wheel-square" style={{ '--wheel-hue': pureHue } as CSSProperties}>
        <div
          ref={svKey}
          className="app-wheel-handle"
          role="slider"
          tabIndex={0}
          aria-label="Saturation and brightness"
          aria-describedby={`${id}-sv`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={s}
          aria-valuetext={`Saturation ${s}%, brightness ${b}%`}
          onKeyDown={onSvKeys}
          style={{ left: `${value.s * 100}%`, top: `${(1 - value.v) * 100}%`, '--wheel-swatch': hex } as CSSProperties}
        />
      </div>
      <div
        ref={hueKey}
        className="app-wheel-handle"
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(value.h)}
        aria-valuetext={`${Math.round(value.h)} degrees, ${hueName(value.h)}`}
        onKeyDown={onHueKeys}
        style={{
          left: `calc(50% + ${Math.sin(rad).toFixed(4)} * (50% - ${RING / 2}px))`,
          top: `calc(50% - ${Math.cos(rad).toFixed(4)} * (50% - ${RING / 2}px))`,
          '--wheel-swatch': pureHue,
        } as CSSProperties}
      />
      <span id={`${id}-sv`} className="sr-only">Left and right change saturation, up and down change brightness.</span>
    </div>
  );
}
