import { Bookmark } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FlowRydShell } from "@/components/flowryd-demo-shell";
import { demoCarList } from "@/lib/flowryd-demo-data";

export const metadata = {
  title: "Saved — FlowRyd"
};

export default function SavedPage() {
  return (
    <FlowRydShell>
      <div className="flow-page">
        <header className="flow-page-header">
          <h1>Saved cars</h1>
          <p>Your shortlisted matches, ready to compare.</p>
        </header>

        <div className="flow-card-grid flow-card-grid-three">
          {demoCarList.map((car) => (
            <Link className="flow-car-card" href={`/car/${car.id}`} key={car.id}>
              <div className="flow-car-media">
                <Image src={car.image} alt={car.name} width={720} height={520} />
                <span className="trending-match">{car.match}% match</span>
                <span className="trending-save">
                  <Bookmark size={18} aria-hidden="true" />
                </span>
              </div>
              <div className="trending-body">
                <h3>{car.name}</h3>
                <p>{car.location}</p>
                <div className="trending-meta">
                  <span>{car.price}</span>
                  <span>{car.condition}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </FlowRydShell>
  );
}
