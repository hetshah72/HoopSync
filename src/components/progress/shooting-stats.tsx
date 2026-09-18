import { Crosshair, Percent, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { ZoneBar } from "@/components/ui/zone-bar";
import { SHOT_ZONES, fgPercent, type ZoneBreakdown } from "@/lib/shot-zones";

/**
 * BRD 7.11's "Shooting statistics", made visible.
 *
 * Every number comes from shots the player tap-logged themselves - the one
 * part of Analyze that is real primary data rather than generated (BRD v1.1
 * §5). Lifetime totals come from the counters each finalized session wrote;
 * the zone rows are pooled from those sessions' own breakdowns.
 *
 * Zone rows show makes/attempts alongside the percentage on purpose: a bar by
 * itself cannot distinguish 8-for-8 from 1-for-1, and Progress should never
 * imply more evidence than there is.
 */
export function ShootingStats({
  totalShotSessions,
  totalShotAttempts,
  totalShotMakes,
  lifetimeFgPercent,
  pooledZones,
  sessionsInSample,
}: {
  totalShotSessions: number;
  totalShotAttempts: number;
  totalShotMakes: number;
  lifetimeFgPercent?: number;
  pooledZones: ZoneBreakdown;
  sessionsInSample: number;
}) {
  if (totalShotSessions === 0) return null;

  // Fixed taxonomy order rather than object key order, so the list reads the
  // same way every render regardless of which zones were logged first.
  const zoneRows = SHOT_ZONES.map((zone) => ({
    zone,
    stats: pooledZones[zone],
  })).filter(
    (row): row is { zone: (typeof SHOT_ZONES)[number]; stats: { attempts: number; makes: number } } =>
      Boolean(row.stats && row.stats.attempts > 0),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shooting</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatTile
            value={totalShotSessions}
            label="Sessions logged"
            icon={Crosshair}
            tone="brand"
          />
          <StatTile
            value={`${totalShotMakes}/${totalShotAttempts}`}
            label="Shots made"
            icon={Target}
          />
          <StatTile
            value={lifetimeFgPercent !== undefined ? `${lifetimeFgPercent}%` : "—"}
            label="Field goal %"
            icon={Percent}
            tone="success"
          />
        </div>

        {zoneRows.length > 0 && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">By zone</p>
              <p className="text-xs text-muted-foreground">
                Pooled across your last{" "}
                {sessionsInSample === 1
                  ? "session"
                  : `${sessionsInSample} sessions`}
                .
              </p>
            </div>
            {zoneRows.map(({ zone, stats }) => (
              <ZoneBar
                key={zone}
                zone={zone}
                attempts={stats.attempts}
                makes={stats.makes}
                pct={fgPercent(stats.makes, stats.attempts)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
