import { ShieldCheck } from "lucide-react";
import { listContentAssets } from "@/server/services/adminContentService";
import { listLibraryFeedItems } from "@/server/repositories/feedRepository";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ContentIngestForm } from "@/components/admin/content-ingest-form";
import { ContentAssetList } from "@/components/admin/content-asset-list";

export const metadata = { title: "Admin - library" };

/**
 * The content pipeline's human half (BRD 7.14: "MVP for the content pipeline
 * itself"): take delivery of a clip, record the rights it arrived under, clear
 * those rights, publish.
 *
 * Sits alongside `/admin/content`, which reports what the library *is*. This
 * is where it changes.
 *
 * No role check here - `src/app/admin/layout.tsx` already gates the whole
 * area, and re-checking would be a second answer to a question that already
 * has one. The actions behind the buttons re-check independently, because a
 * Server Action is a public endpoint regardless of which page rendered it.
 */
export default async function AdminLibraryPage() {
  const [assets, libraryItems] = await Promise.all([
    listContentAssets(),
    listLibraryFeedItems(),
  ]);

  const attachTargets = libraryItems.map((item) => ({
    id: item._id.toString(),
    title: item.title,
    hasMedia: Boolean(item.mediaAssetId),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Admin"
        title="Library"
        description="Every clip HoopSync ships, and the rights it ships under. Nothing reaches a player's feed until those rights are cleared."
      />

      <ContentIngestForm />

      {assets.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No library clips yet"
          description="Upload a clip above. You'll be asked where it came from and who owns it before it can be published."
        />
      ) : (
        <ContentAssetList assets={assets} attachTargets={attachTargets} />
      )}
    </div>
  );
}
