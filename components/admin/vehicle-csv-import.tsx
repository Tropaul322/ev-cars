"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

export function VehicleCsvImport() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    embedded: number;
    skipped: number;
    errors: string[];
    embeddingError?: string;
  } | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("csv") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) {
      toast.error("Choose a CSV file first.");
      return;
    }

    setPending(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/admin/vehicles/import", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json()) as {
        imported: number;
        embedded: number;
        skipped: number;
        errors: string[];
        embeddingError?: string;
        error?: string;
      };

      if (!response.ok) {
        toast.error(payload.error ?? "Import failed.");
        return;
      }

      setResult(payload);
      if (payload.embeddingError) {
        toast.warning(`Imported ${payload.imported} vehicles, but embedding had issues.`);
      } else {
        toast.success(`Imported ${payload.imported} vehicles.`);
      }
      form.reset();
    } catch {
      toast.error("Import failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="rounded-3xl">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-extrabold">Import vehicles from CSV</CardTitle>
        <CardDescription>
          Upload a spreadsheet CSV using the same columns as `data/templates/vehicles-sheet-template.csv`.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="csv">CSV file</Label>
            <input id="csv" name="csv" type="file" accept=".csv,text/csv" className="text-sm" />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Importing..." : "Import CSV"}
            </Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href="/templates/vehicles-sheet-template.csv" download />}
            >
              Download template
            </Button>
          </div>
        </form>

        {result ? (
          <div className="rounded-2xl bg-muted/50 p-4 text-sm">
            <p>Imported: {result.imported}</p>
            <p>Embedded: {result.embedded}</p>
            <p>Skipped embeddings: {result.skipped}</p>
            {result.embeddingError ? <p className="text-destructive">{result.embeddingError}</p> : null}
            {result.errors.length ? (
              <div className="mt-3 flex flex-col gap-1 text-destructive">
                {result.errors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
