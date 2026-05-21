import { useLoaderData, Link, useRevalidator, useOutletContext } from "react-router";
import { useState } from "react";
import { listDynamicImages, deleteDynamicImage, publishDynamicImage, unpublishDynamicImage, cloneDynamicImage } from "~/lib/api/dynamic-images";
import { formatDate } from "~/lib/utils";
import { ConfirmModal } from "~/components/ConfirmModal";
import type { DynamicImage } from "~/lib/types";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { isSuperAdminRole } from "~/lib/roles";
import type { User } from "~/lib/types";

export function meta() {
  return [{ title: "Dynamic Images | GDGoC Admin" }];
}

export async function clientLoader() {
  return listDynamicImages();
}

export default function DynamicImagesPage() {
  const images = useLoaderData<typeof clientLoader>();
  const revalidator = useRevalidator();
  const { user } = useOutletContext<{ user: User }>();
  const [deleteModal, setDeleteModal] = useState<{ img: DynamicImage } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const isOwner = (img: DynamicImage) =>
    isSuperAdminRole(user.role) || user.id === img.owner_user_id;

  const togglePublish = async (img: DynamicImage) => {
    setLoadingId(img.id);
    try {
      if (img.status === "published") {
        await unpublishDynamicImage(img.id);
      } else {
        await publishDynamicImage(img.id);
      }
      revalidator.revalidate();
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dynamic Images</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Renderable images served via{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/v1/images/:id?field=value</code>
            {" "}— only <strong>published</strong> images respond to render requests.
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/dynamic-images/new">+ New Dynamic Image</Link>
        </Button>
      </div>

      {images.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-base">No dynamic images yet.</p>
          <p className="text-sm mt-1">Create one to generate on-demand images from a URL.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {images.map((img) => (
            <Card key={img.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h2 className="font-semibold truncate text-foreground">{img.name}</h2>
                  <Badge variant={img.status === "published" ? "default" : "secondary"} className="shrink-0 text-[11px]">
                    {img.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                  {img.description || "No description"}
                </p>
                <div className="flex gap-2 flex-wrap justify-between items-center">
                  <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                    <span>Updated {formatDate(img.updated_at)}</span>
                    {img.created_by_name && <span>By {img.created_by_name}</span>}
                  </div>
                  <div className="flex gap-2">
                    {isOwner(img) ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 px-2"
                          disabled={loadingId === img.id}
                          onClick={() => togglePublish(img)}
                        >
                          {img.status === "published" ? "Unpublish" : "Publish"}
                        </Button>
                        <Link
                          to={`/dynamic-images/${img.id}/editor`}
                          className="text-xs text-primary hover:underline font-medium self-center"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:underline self-center"
                          disabled={loadingId === img.id + "-clone"}
                          onClick={async () => {
                            setLoadingId(img.id + "-clone");
                            try { await cloneDynamicImage(img.id); revalidator.revalidate(); }
                            finally { setLoadingId(null); }
                          }}
                        >
                          {loadingId === img.id + "-clone" ? "Cloning…" : "Clone"}
                        </button>
                        <button
                          type="button"
                          className="text-xs text-destructive hover:underline self-center"
                          onClick={() => setDeleteModal({ img })}
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 px-2"
                        disabled={loadingId === img.id + "-clone"}
                        onClick={async () => {
                          setLoadingId(img.id + "-clone");
                          try { await cloneDynamicImage(img.id); revalidator.revalidate(); }
                          finally { setLoadingId(null); }
                        }}
                      >
                        Clone
                      </Button>
                    )}
                    <Link
                      to={`/dynamic-images/${img.id}`}
                      className="text-xs text-muted-foreground hover:underline self-center"
                    >
                      Details
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {deleteModal && (
        <ConfirmModal
          title="Delete dynamic image?"
          message={`Delete "${deleteModal.img.name}"? This cannot be undone.`}
          destructive
          confirmLabel="Delete"
          onConfirm={async () => {
            await deleteDynamicImage(deleteModal.img.id);
            setDeleteModal(null);
            revalidator.revalidate();
          }}
          onCancel={() => setDeleteModal(null)}
        />
      )}
    </div>
  );
}
