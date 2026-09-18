import { getAdminOverview } from "@/server/services/adminService";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";

export const metadata = { title: "Admin overview" };

/**
 * Every figure here is a live row count. There is deliberately no growth
 * chart, no retention curve and no derived engagement score: this app has been
 * live for days, and a trend line drawn over that is decoration that invites
 * conclusions the data can't support.
 */
export default async function AdminOverviewPage() {
  const { highlights, collections } = await getAdminOverview();

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Overview"
        description="Live row counts straight from MongoDB."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {highlights.map((item) => (
          <StatTile
            key={item.label}
            value={item.value.toLocaleString()}
            label={item.label}
            tone="brand"
          />
        ))}
      </div>

      <Card className="mt-5">
        <CardContent>
          <h2 className="font-heading text-sm font-semibold tracking-tight">
            Every collection
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Driven off the shared collection list, so a collection added later
            appears here without anyone remembering to update this screen.
          </p>

          <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border/70 ring-1 ring-border/70 sm:grid-cols-3 lg:grid-cols-4">
            {collections.map((collection) => (
              <div key={collection.name} className="bg-card px-3.5 py-3">
                <dd className="tabular font-heading text-lg leading-none font-bold tracking-tight">
                  {collection.count.toLocaleString()}
                </dd>
                <dt className="mt-1.5 truncate text-[0.6875rem] font-medium text-muted-foreground">
                  {collection.name}
                </dt>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
