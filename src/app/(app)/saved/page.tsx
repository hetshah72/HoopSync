import { ObjectId } from "mongodb";
import { Bookmark } from "lucide-react";
import { auth } from "@/server/auth/auth";
import { getSavedFeed } from "@/server/services/feedService";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { FeedCard } from "@/components/feed/feed-card";

/**
 * Saved items (BRD 11.2: "saved content appears in Saved").
 *
 * Save had been a real write with nowhere to read it back - the audit called
 * it "a working write nobody can ever read back". This is that destination.
 * It is deliberately not a seventh nav destination: the nav is fixed at six by
 * BRD v1.1 §4, so Saved is reached from the bookmark control on Home.
 */
export default async function SavedPage() {
  const session = await auth();
  const userId = session?.user?.id ? new ObjectId(session.user.id) : null;
  const items = userId ? await getSavedFeed(userId) : [];

  return (
    <div>
      <PageHeader
        back={{ href: "/home", label: "Back to Home" }}
        eyebrow="Your library"
        title="Saved"
        description="Everything you've bookmarked from the feed, kept in one place."
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="Nothing saved yet"
          description="Tap Save on any card in your feed and it will show up here."
        />
      ) : (
        // Saved cards are self-contained, so they tile rather than stacking in
        // one column the way the chronological Home feed has to.
        <div className="grid gap-3 lg:grid-cols-2 lg:items-start lg:gap-4">
          {items.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
