import { useLoaderData, Link, useNavigate, useRevalidator, useOutletContext } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/detail";
import { getDynamicImage, deleteDynamicImage, getDynamicImageUrl, publishDynamicImage, unpublishDynamicImage, cloneDynamicImage } from "~/lib/api/dynamic-images";
import { formatDate } from "~/lib/utils";
import { ConfirmModal } from "~/components/ConfirmModal";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { isSuperAdminRole } from "~/lib/roles";
import type { User } from "~/lib/types";

export function meta() {
  return [{ title: "Dynamic Image | GDGoC Admin" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return getDynamicImage(params.id);
}

export default function DynamicImageDetailPage() {
  const image = useLoaderData<typeof clientLoader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { user } = useOutletContext<{ user: User }>();

  const isOwner = isSuperAdminRole(user.role) || user.id === image.owner_user_id;

  const [deleteModal, setDeleteModal] = useState(false);
  const [publishLoading, setPublishLoading] = useState(false);
  const [cloneLoading, setCloneLoading] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(
    Object.fromEntries(image.fields.map((f) => [f.key, ""])),
  );
  const [previewKey, setPreviewKey] = useState(0); // bump to refresh preview

  const previewUrl = getDynamicImageUrl(image.id, fieldValues);

  const handleDelete = async () => {
    await deleteDynamicImage(image.id);
    navigate("/dynamic-images");
  };

  const handleTogglePublish = async () => {
    setPublishLoading(true);
    try {
      if (image.status === "published") {
        await unpublishDynamicImage(image.id);
      } else {
        await publishDynamicImage(image.id);
      }
      revalidator.revalidate();
    } finally {
      setPublishLoading(false);
    }
  };

  const allFilled = image.fields.every((f) => fieldValues[f.key]?.trim());

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <Link to="/dynamic-images" className="text-sm text-muted-foreground hover:underline">
            ← Dynamic Images
          </Link>
          <div className="flex items-center gap-2 mt-1">
            <h1 className="text-xl font-semibold text-foreground">{image.name}</h1>
            <Badge variant={image.status === "published" ? "default" : "secondary"} className="text-[11px]">
              {image.status}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {isOwner ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={publishLoading}
                onClick={handleTogglePublish}
              >
                {image.status === "published" ? "Unpublish" : "Publish"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={cloneLoading}
                onClick={async () => {
                  setCloneLoading(true);
                  try {
                    const copy = await cloneDynamicImage(image.id);
                    navigate(`/dynamic-images/${copy.id}/editor`);
                  } finally {
                    setCloneLoading(false);
                  }
                }}
              >
                {cloneLoading ? "Cloning…" : "Clone"}
              </Button>
              <Button asChild size="sm">
                <Link to={`/dynamic-images/${image.id}/editor`}>Open Editor</Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/30 hover:bg-red-soft"
                onClick={() => setDeleteModal(true)}
              >
                Delete
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={cloneLoading}
              onClick={async () => {
                setCloneLoading(true);
                try {
                  const copy = await cloneDynamicImage(image.id);
                  navigate(`/dynamic-images/${copy.id}/editor`);
                } finally {
                  setCloneLoading(false);
                }
              }}
            >
              {cloneLoading ? "Cloning…" : "Clone & Edit"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: metadata + URL */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-5 space-y-3">
              {image.description && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm">{image.description}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Created</p>
                  <p>{formatDate(image.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Updated</p>
                  <p>{formatDate(image.updated_at)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Dynamic fields preview */}
          <Card>
            <CardContent className="p-5">
              <p className="text-sm font-medium mb-3">
                Dynamic Fields
                {image.fields.length === 0 && (
                  <span className="text-muted-foreground font-normal ml-2 text-xs">
                    — add text layers with "Dynamic" enabled in the editor
                  </span>
                )}
              </p>

              {image.fields.length > 0 && (
                <div className="space-y-3 mb-4">
                  {image.fields.map((f) => (
                    <div key={f.key} className="space-y-1">
                      <Label htmlFor={`field-${f.key}`} className="text-xs">
                        {f.label}{" "}
                        <code className="text-muted-foreground text-xs">?{f.key}=…</code>
                      </Label>
                      <Input
                        id={`field-${f.key}`}
                        value={fieldValues[f.key] ?? ""}
                        onChange={(e) =>
                          setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                        }
                        placeholder={`Enter ${f.label.toLowerCase()}`}
                      />
                    </div>
                  ))}
                </div>
              )}

              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setPreviewKey((k) => k + 1)}
              >
                {previewKey === 0 ? "Load Preview" : "Refresh Preview"}
              </Button>
            </CardContent>
          </Card>

          {/* Render URL */}
          <Card>
            <CardContent className="p-5">
              <p className="text-sm font-medium mb-2">Render URL</p>
              <code className="text-xs bg-muted px-2 py-1.5 rounded block break-all select-all">
                {previewUrl}
              </code>
              <p className="text-xs text-muted-foreground mt-2">
                This public URL returns a PNG image. Replace placeholder values with real data.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right: preview */}
        <div>
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {previewKey > 0 ? (
                <img
                  key={`${previewKey}-${JSON.stringify(fieldValues)}`}
                  src={previewUrl}
                  alt="Dynamic image preview"
                  className="w-full h-auto object-contain max-h-[480px]"
                />
              ) : (
                <div className="flex items-center justify-center h-64 text-muted-foreground text-sm bg-muted/30">
                  Click "Load Preview" to render
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {deleteModal && (
        <ConfirmModal
          title="Delete dynamic image?"
          message="This cannot be undone. The image will no longer be accessible at its URL."
          destructive
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleteModal(false)}
        />
      )}
    </div>
  );
}
