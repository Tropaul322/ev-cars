import { cookies } from "next/headers";
import { DemoAccessRequired } from "@/components/demo-access-required";
import { WebShell } from "@/components/WebShell";
import { SavedCarGrid, type SavedCarCard } from "@/components/saved-car-grid";
import {
  DEMO_REGISTRATION_COOKIE,
  getDemoRegistration,
  isActiveDemoRegistration,
} from "@/lib/demo-registration";
import {
  listSavedCars,
  snapshotFromVehicle,
  type SavedCar,
  type SavedCarSnapshot,
} from "@/lib/repositories/saved-car-repository";

export const metadata = {
  title: "Saved — FlowRyd",
};

export default async function SavedPage() {
  const savedCars = await getSavedCarsForCurrentTester();

  return (
    <WebShell>
      <DemoAccessRequired />
      <div className="mx-auto max-w-7xl w-full px-6 lg:px-10 py-10">
        <header className="mb-8">
          <h1 className="font-display font-extrabold text-3xl">Saved cars</h1>
          <p className="text-muted-foreground mt-1">
            Your shortlisted matches, ready to compare.
          </p>
        </header>

        <SavedCarGrid cars={savedCars} />
      </div>
    </WebShell>
  );
}

async function getSavedCarsForCurrentTester(): Promise<SavedCarCard[]> {
  const cookieStore = await cookies();
  const registration = await getDemoRegistration(cookieStore.get(DEMO_REGISTRATION_COOKIE)?.value);
  if (!isActiveDemoRegistration(registration)) return [];

  const savedCars = await listSavedCars(registration!.id);
  return savedCars.map(savedCarToCard);
}

function savedCarToCard(savedCar: SavedCar): SavedCarCard {
  const snapshot = snapshotForSavedCar(savedCar);
  return {
    id: savedCar.vehicleId,
    href: savedCar.vehicle?.listingUrl ?? `/car/${savedCar.vehicleId}`,
    snapshot,
    vehicle: savedCar.vehicle,
  };
}

function snapshotForSavedCar(savedCar: SavedCar): SavedCarSnapshot {
  if (savedCar.vehicle) {
    return {
      ...snapshotFromVehicle(savedCar.vehicle, savedCar.snapshot?.match),
      ...savedCar.snapshot,
      id: savedCar.vehicleId,
    };
  }

  return (
    savedCar.snapshot ?? {
      id: savedCar.vehicleId,
      name: savedCar.vehicleId,
      price: "Price on request",
      condition: "EV",
    }
  );
}
