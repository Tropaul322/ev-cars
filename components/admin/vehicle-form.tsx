"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  adminVehicleApiPath,
  adminVehicleEditPath,
  buildDefaultVehicle,
  generateVehicleId,
  normalizeVehiclePayload,
  VEHICLE_WIZARD_BODY_TYPES,
  VEHICLE_WIZARD_CONDITIONS,
  VEHICLE_WIZARD_FEATURES
} from "@/lib/admin-vehicle-helpers";
import type { Feature, Vehicle } from "@/lib/types";
import { formatEUR } from "@/lib/utils";

const steps = ["Identity", "Pricing", "Specs", "Details", "Review"] as const;

type VehicleFormProps = {
  initialVehicle?: Vehicle;
  mode: "create" | "edit";
};

type FormState = {
  id: string;
  make: string;
  model: string;
  trim: string;
  year: string;
  condition: Vehicle["condition"];
  priceEUR: string;
  monthlyLeaseEUR: string;
  rangeKm: string;
  batteryKwh: string;
  batterySoH: string;
  mileageKm: string;
  bodyType: Vehicle["bodyType"];
  seats: string;
  drivetrain: Vehicle["drivetrain"];
  powerKw: string;
  efficiencyKwhPer100Km: string;
  cargoLiters: string;
  location: string;
  notes: string;
  listingUrl: string;
  images: string;
  features: Feature[];
  brandOrigin: Vehicle["brandOrigin"];
  reviewTags: string;
};

function vehicleToFormState(vehicle: Vehicle): FormState {
  return {
    id: vehicle.id,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim ?? "",
    year: String(vehicle.year),
    condition: vehicle.condition,
    priceEUR: String(vehicle.priceEUR ?? ""),
    monthlyLeaseEUR: vehicle.monthlyLeaseEUR === null ? "" : String(vehicle.monthlyLeaseEUR),
    rangeKm: String(vehicle.rangeKm ?? ""),
    batteryKwh: String(vehicle.batteryKwh ?? ""),
    batterySoH: vehicle.batterySoH === null ? "" : String(vehicle.batterySoH),
    mileageKm: vehicle.mileageKm === null ? "" : String(vehicle.mileageKm),
    bodyType: vehicle.bodyType,
    seats: String(vehicle.seats ?? ""),
    drivetrain: vehicle.drivetrain,
    powerKw: String(vehicle.powerKw ?? ""),
    efficiencyKwhPer100Km: String(vehicle.efficiencyKwhPer100Km ?? ""),
    cargoLiters: String(vehicle.cargoLiters ?? ""),
    location: vehicle.location ?? "",
    notes: vehicle.notes ?? "",
    listingUrl: vehicle.listingUrl ?? "",
    images: (vehicle.images ?? []).join("\n"),
    features: vehicle.features ?? [],
    brandOrigin: vehicle.brandOrigin ?? "europe",
    reviewTags: (vehicle.reviewTags ?? []).join("|")
  };
}

function emptyFormState(): FormState {
  return vehicleToFormState(
    buildDefaultVehicle({
      make: "",
      model: "",
      year: new Date().getFullYear()
    })
  );
}

export function VehicleForm({ initialVehicle, mode }: VehicleFormProps) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState<FormState>(() =>
    initialVehicle ? vehicleToFormState(initialVehicle) : emptyFormState()
  );

  const previewVehicle = useMemo(() => buildVehicleFromForm(form), [form]);

  function updateForm(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function toggleFeature(feature: Feature) {
    setForm((current) => ({
      ...current,
      features: current.features.includes(feature)
        ? current.features.filter((value) => value !== feature)
        : [...current.features, feature]
    }));
  }

  async function handleSubmit() {
    setPending(true);
    try {
      const built = buildVehicleFromForm(form);
      const vehicle =
        mode === "edit" && initialVehicle
          ? normalizeVehiclePayload({ ...initialVehicle, ...built, id: initialVehicle.id })
          : built;
      const response = await fetch(
        mode === "create" ? "/api/admin/vehicles" : adminVehicleApiPath(vehicle.id),
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(vehicle)
        }
      );
      const payload = (await response.json()) as { error?: string; embedded?: boolean; embeddingError?: string };

      if (!response.ok) {
        toast.error(payload.error ?? "Failed to save vehicle.");
        return;
      }

      if (payload.embeddingError) {
        toast.warning(`Vehicle saved, but embedding failed: ${payload.embeddingError}`);
      } else if (payload.embedded === false) {
        toast.success("Vehicle saved. Embedding unchanged.");
      } else {
        toast.success("Vehicle saved and embedded.");
      }

      router.push("/admin/vehicles");
      router.refresh();
    } catch {
      toast.error("Failed to save vehicle.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {steps.map((step, index) => (
          <Button
            key={step}
            type="button"
            variant={index === stepIndex ? "default" : "outline"}
            size="sm"
            onClick={() => setStepIndex(index)}
          >
            {index + 1}. {step}
          </Button>
        ))}
      </div>

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="font-display text-2xl font-extrabold">{steps[stepIndex]}</CardTitle>
          <CardDescription>
            {mode === "create" ? "Add a new vehicle to the inventory." : "Update vehicle details."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {stepIndex === 0 ? (
            <>
              <Field label="ID" hint="Leave blank to auto-generate from make, model, and year.">
                <Input
                  value={form.id}
                  onChange={(event) => updateForm({ id: event.target.value })}
                  disabled={mode === "edit"}
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Make">
                  <Input value={form.make} onChange={(event) => updateForm({ make: event.target.value })} required />
                </Field>
                <Field label="Model">
                  <Input value={form.model} onChange={(event) => updateForm({ model: event.target.value })} required />
                </Field>
                <Field label="Trim">
                  <Input value={form.trim} onChange={(event) => updateForm({ trim: event.target.value })} />
                </Field>
                <Field label="Year">
                  <Input value={form.year} onChange={(event) => updateForm({ year: event.target.value })} required />
                </Field>
              </div>
              <Field label="Condition">
                <Select value={form.condition} onValueChange={(value) => updateForm({ condition: value as Vehicle["condition"] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VEHICLE_WIZARD_CONDITIONS.map((condition) => (
                      <SelectItem key={condition} value={condition}>
                        {condition}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          ) : null}

          {stepIndex === 1 ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Price (EUR)">
                <Input value={form.priceEUR} onChange={(event) => updateForm({ priceEUR: event.target.value })} />
              </Field>
              <Field label="Monthly lease (EUR)">
                <Input
                  value={form.monthlyLeaseEUR}
                  onChange={(event) => updateForm({ monthlyLeaseEUR: event.target.value })}
                />
              </Field>
            </div>
          ) : null}

          {stepIndex === 2 ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Range (km)">
                <Input value={form.rangeKm} onChange={(event) => updateForm({ rangeKm: event.target.value })} />
              </Field>
              <Field label="Battery (kWh)">
                <Input value={form.batteryKwh} onChange={(event) => updateForm({ batteryKwh: event.target.value })} />
              </Field>
              <Field label="Battery SoH (%)">
                <Input value={form.batterySoH} onChange={(event) => updateForm({ batterySoH: event.target.value })} />
              </Field>
              <Field label="Mileage (km)">
                <Input value={form.mileageKm} onChange={(event) => updateForm({ mileageKm: event.target.value })} />
              </Field>
              <Field label="Body type">
                <Select value={form.bodyType} onValueChange={(value) => updateForm({ bodyType: value as Vehicle["bodyType"] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VEHICLE_WIZARD_BODY_TYPES.map((bodyType) => (
                      <SelectItem key={bodyType} value={bodyType}>
                        {bodyType}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Seats">
                <Input value={form.seats} onChange={(event) => updateForm({ seats: event.target.value })} />
              </Field>
              <Field label="Drivetrain">
                <Select value={form.drivetrain} onValueChange={(value) => updateForm({ drivetrain: value as Vehicle["drivetrain"] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["FWD", "RWD", "AWD"].map((drivetrain) => (
                      <SelectItem key={drivetrain} value={drivetrain}>
                        {drivetrain}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Power (kW)">
                <Input value={form.powerKw} onChange={(event) => updateForm({ powerKw: event.target.value })} />
              </Field>
              <Field label="Efficiency (kWh/100km)">
                <Input
                  value={form.efficiencyKwhPer100Km}
                  onChange={(event) => updateForm({ efficiencyKwhPer100Km: event.target.value })}
                />
              </Field>
              <Field label="Cargo (liters)">
                <Input value={form.cargoLiters} onChange={(event) => updateForm({ cargoLiters: event.target.value })} />
              </Field>
            </div>
          ) : null}

          {stepIndex === 3 ? (
            <>
              <Field label="Location">
                <Input value={form.location} onChange={(event) => updateForm({ location: event.target.value })} />
              </Field>
              <Field label="Listing URL">
                <Input value={form.listingUrl} onChange={(event) => updateForm({ listingUrl: event.target.value })} />
              </Field>
              <Field label="Images" hint="One URL per line.">
                <Textarea value={form.images} onChange={(event) => updateForm({ images: event.target.value })} rows={4} />
              </Field>
              <Field label="Notes">
                <Textarea value={form.notes} onChange={(event) => updateForm({ notes: event.target.value })} rows={4} />
              </Field>
              <Field label="Review tags" hint="Separate with |">
                <Input value={form.reviewTags} onChange={(event) => updateForm({ reviewTags: event.target.value })} />
              </Field>
              <div className="flex flex-col gap-2">
                <Label>Features</Label>
                <div className="flex flex-wrap gap-2">
                  {VEHICLE_WIZARD_FEATURES.map((feature) => {
                    const active = form.features.includes(feature);
                    return (
                      <Button
                        key={feature}
                        type="button"
                        size="sm"
                        variant={active ? "default" : "outline"}
                        onClick={() => toggleFeature(feature)}
                      >
                        {feature.replaceAll("_", " ")}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}

          {stepIndex === 4 ? (
            <div className="rounded-2xl bg-muted/50 p-4 text-sm">
              <p className="font-medium">
                {previewVehicle.make} {previewVehicle.model} ({previewVehicle.year})
              </p>
              <p className="text-muted-foreground">ID: {previewVehicle.id}</p>
              <p>Price: {formatEUR(previewVehicle.priceEUR)}</p>
              <p>Range: {previewVehicle.rangeKm} km</p>
              <p>Location: {previewVehicle.location ?? "—"}</p>
              <p>Features: {previewVehicle.features.join(", ") || "—"}</p>
            </div>
          ) : null}

          <div className="flex justify-between gap-3 pt-2">
            <Button type="button" variant="outline" disabled={stepIndex === 0} onClick={() => setStepIndex((value) => value - 1)}>
              Back
            </Button>
            {stepIndex < steps.length - 1 ? (
              <Button type="button" onClick={() => setStepIndex((value) => value + 1)}>
                Next
              </Button>
            ) : (
              <Button type="button" disabled={pending} onClick={handleSubmit}>
                {pending ? "Saving..." : mode === "create" ? "Create vehicle" : "Save changes"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function buildVehicleFromForm(form: FormState): Vehicle {
  const make = form.make.trim();
  const model = form.model.trim();
  const year = Number(form.year);
  const id =
    form.id.trim() ||
    (make && model && Number.isFinite(year) ? generateVehicleId(make, model, year) : crypto.randomUUID());

  return buildDefaultVehicle({
    id,
    make,
    model,
    trim: form.trim.trim(),
    year,
    condition: form.condition,
    priceEUR: Number(form.priceEUR) || 0,
    monthlyLeaseEUR: form.monthlyLeaseEUR ? Number(form.monthlyLeaseEUR) : null,
    rangeKm: Number(form.rangeKm) || 0,
    batteryKwh: Number(form.batteryKwh) || 0,
    batterySoH: form.batterySoH ? Number(form.batterySoH) : null,
    mileageKm: form.mileageKm ? Number(form.mileageKm) : null,
    bodyType: form.bodyType,
    seats: Number(form.seats) || 5,
    drivetrain: form.drivetrain,
    powerKw: Number(form.powerKw) || 0,
    efficiencyKwhPer100Km: Number(form.efficiencyKwhPer100Km) || 16,
    cargoLiters: Number(form.cargoLiters) || 0,
    location: form.location.trim() || null,
    notes: form.notes.trim(),
    listingUrl: form.listingUrl.trim() || undefined,
    images: form.images
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
    features: form.features,
    brandOrigin: form.brandOrigin,
    reviewTags: form.reviewTags
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean)
  });
}
