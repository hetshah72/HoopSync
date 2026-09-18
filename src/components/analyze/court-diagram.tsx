"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

export interface ShotMarker {
  id: string;
  xPct: number;
  yPct: number;
  made: boolean;
}

interface CourtDiagramProps {
  shots?: ShotMarker[];
  selectedShotId?: string;
  onShotClick?: (id: string) => void;
  /** Present => interactive mode: tapping empty court reports a location. */
  onCourtClick?: (xPct: number, yPct: number) => void;
}

/**
 * A single component serves two roles: the tap-to-log input (via
 * onCourtClick, during a Shooting Session recording) and the read-only shot
 * chart (via `shots` + onShotClick, in the finished report). Court lines
 * below are a visual approximation, not regulation geometry - see
 * src/lib/shot-zones.ts's zoneFromLocation for the actual zone boundaries
 * a tap is classified against.
 */
export function CourtDiagram({
  shots = [],
  selectedShotId,
  onShotClick,
  onCourtClick,
}: CourtDiagramProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  function handleCourtClick(event: React.MouseEvent<SVGSVGElement>) {
    if (!onCourtClick || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xPct = ((event.clientX - rect.left) / rect.width) * 100;
    const yPct = ((event.clientY - rect.top) / rect.height) * 100;
    onCourtClick(xPct, yPct);
  }

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 300 300"
      onClick={handleCourtClick}
      className={cn(
        // Capped and centred: the viewBox is square, so an uncapped `w-full`
        // court grew to the full width of a desktop column and became a
        // ~950px-tall diagram you had to scroll past.
        "mx-auto block w-full max-w-lg rounded-xl border border-brand/15 bg-brand-soft/40 text-muted-foreground/70",
        onCourtClick && "cursor-crosshair",
      )}
    >
      {/* Decorative court lines - not clickable, not used for classification */}
      <rect x={1} y={1} width={298} height={298} fill="none" stroke="currentColor" strokeWidth={1} />
      <rect x={100} y={0} width={100} height={115} fill="none" stroke="currentColor" strokeWidth={1} />
      <circle cx={150} cy={115} r={38} fill="none" stroke="currentColor" strokeWidth={1} />
      <circle cx={150} cy={22} r={7.5} fill="none" stroke="currentColor" strokeWidth={1.5} />
      <line x1={138} y1={12} x2={162} y2={12} stroke="currentColor" strokeWidth={1.5} />
      <path
        d="M 5 45 Q 150 250 295 45"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />

      {shots.map((shot) => (
        <circle
          key={shot.id}
          cx={(shot.xPct / 100) * 300}
          cy={(shot.yPct / 100) * 300}
          r={selectedShotId === shot.id ? 8 : 6}
          fill={shot.made ? "#10b981" : "white"}
          stroke={shot.made ? "#10b981" : "#ef4444"}
          strokeWidth={selectedShotId === shot.id ? 3 : 2}
          className={onShotClick ? "cursor-pointer" : undefined}
          onClick={(event) => {
            if (onShotClick) {
              event.stopPropagation();
              onShotClick(shot.id);
            }
          }}
        />
      ))}
    </svg>
  );
}
