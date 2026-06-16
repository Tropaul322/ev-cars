import { cookies } from "next/headers";
import { DemoAccessRequired } from "@/components/demo-access-required";
import { FlowRydShell } from "@/components/flowryd-demo-shell";
import { SavedCarGrid, type SavedCarCard } from "@/components/saved-car-grid";
import {
  DEMO_REGISTRATION_COOKIE,
  getDemoRegistration,
  isActiveDemoRegistration
} from "@/lib/demo-registration";
import {
  listSavedCars,
  snapshotFromVehicle,
  type SavedCar,
  type SavedCarSnapshot
} from "@/lib/repositories/saved-car-repository";

export const metadata = {
  title: "Saved — FlowRyd"
};

export default async function SavedPage() {
  const savedCars = await getSavedCarsForCurrentTester();

  return (
    <FlowRydShell>
      <DemoAccessRequired />
      <div className="flow-page">
        <header className="flow-page-header">
          <h1>Saved cars</h1>
          <p>Your shortlisted matches, ready to compare.</p>
        </header>

        <SavedCarGrid cars={savedCars} />
      </div>
    </FlowRydShell>
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
    vehicle: savedCar.vehicle
  };
}

function snapshotForSavedCar(savedCar: SavedCar): SavedCarSnapshot {
  if (savedCar.vehicle) {
    return {
      ...snapshotFromVehicle(savedCar.vehicle, savedCar.snapshot?.match),
      ...savedCar.snapshot,
      id: savedCar.vehicleId
    };
  }

  return (
    savedCar.snapshot ?? {
      id: savedCar.vehicleId,
      name: savedCar.vehicleId,
      price: "Price on request",
      condition: "EV"
    }
  );
}
