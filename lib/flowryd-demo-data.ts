export type DemoCar = {
  id: string;
  name: string;
  brand: string;
  year: number;
  fuel: string;
  range: string;
  mileage?: string;
  location: string;
  price: string;
  match: number;
  image: string;
  condition: "New" | "Used";
  variant: string;
  exterior: string;
  interior: string;
  driverAssist: string;
};

export const demoCars: Record<string, DemoCar> = {
  "tesla-model-y": {
    id: "tesla-model-y",
    name: "TESLA Model Y",
    brand: "Tesla",
    year: 2025,
    fuel: "EV",
    range: "320 mi",
    location: "San Francisco, CA",
    price: "$52,490",
    match: 100,
    image: "/flowryd/car-tesla-y.jpg",
    condition: "New",
    variant: "All-wheel drive, Long Range",
    exterior: 'Pearl white, 20" induction wheels',
    interior: "White interior, 5 seats",
    driverAssist: "Standard autopilot, Full self-driving (supervised)"
  },
  "cadillac-lyriq": {
    id: "cadillac-lyriq",
    name: "Cadillac LYRIQ 2024",
    brand: "Cadillac",
    year: 2024,
    fuel: "EV",
    range: "314 mi",
    location: "San Francisco, CA",
    price: "$60,695",
    match: 100,
    image: "/flowryd/car-cadillac.jpg",
    condition: "New",
    variant: "Rear-wheel drive, Luxury trim",
    exterior: 'Nimbus Metallic, 22" wheels',
    interior: "Sky Cool Gray, 5 seats",
    driverAssist: "Super Cruise hands-free driving"
  },
  "tesla-model-3": {
    id: "tesla-model-3",
    name: "Tesla Model 3",
    brand: "Tesla",
    year: 2024,
    fuel: "EV",
    range: "363 mi",
    mileage: "15,000 mi",
    location: "San Francisco, CA",
    price: "$38,630",
    match: 92,
    image: "/flowryd/car-tesla-3.jpg",
    condition: "Used",
    variant: "Rear-wheel drive, All-wheel drive, Front-wheel drive",
    exterior: 'Deep blue, 19" wheels',
    interior: "Black interior, 5 seats",
    driverAssist: "Standard autopilot, Full self-driving (supervised)"
  },
  "rivian-r1s": {
    id: "rivian-r1s",
    name: "Rivian R1S",
    brand: "Rivian",
    year: 2024,
    fuel: "EV",
    range: "390 mi",
    location: "Los Angeles, CA",
    price: "$77,400",
    match: 88,
    image: "/flowryd/car-rivian.jpg",
    condition: "New",
    variant: "Quad-motor AWD",
    exterior: 'Glacier white, 22" wheels',
    interior: "Ocean Coast, 7 seats",
    driverAssist: "Driver+ adaptive cruise & lane keep"
  }
};

export const demoCarList = Object.values(demoCars);

export const demoSummaries: Record<string, string> = {
  "tesla-model-y":
    "A confident family-ready EV with 320 mi of range, a quiet cabin, and Tesla's mature supercharging network.",
  "cadillac-lyriq":
    'A genuinely luxurious SUV with Super Cruise hands-free highway driving, a 33" curved display, and a smooth ride.',
  "tesla-model-3":
    "The sweet spot of efficiency and range, with low ownership costs and the same Autopilot stack as the Model Y.",
  "rivian-r1s":
    "A serious 7-seat adventure SUV with quad-motor AWD, 390 mi of range, and credible off-road chops."
};

export const demoListingsByModel: Record<string, DemoCar[]> = {
  "tesla-model-y": [
    demoCars["tesla-model-y"],
    {
      ...demoCars["tesla-model-y"],
      image: "/flowryd/car-tesla-y-2.jpg",
      price: "$48,900",
      condition: "Used",
      mileage: "8,200 mi",
      location: "Oakland, CA",
      exterior: 'Midnight blue, 19" wheels'
    },
    {
      ...demoCars["tesla-model-y"],
      image: "/flowryd/car-tesla-y-3.jpg",
      price: "$54,200",
      location: "San Jose, CA",
      exterior: 'Silver metallic, 20" induction wheels'
    }
  ],
  "cadillac-lyriq": [
    demoCars["cadillac-lyriq"],
    {
      ...demoCars["cadillac-lyriq"],
      image: "/flowryd/car-cadillac-2.jpg",
      price: "$57,400",
      condition: "Used",
      mileage: "6,500 mi",
      location: "Palo Alto, CA",
      exterior: 'Stellar Black, 20" wheels'
    }
  ],
  "tesla-model-3": [
    demoCars["tesla-model-3"],
    {
      ...demoCars["tesla-model-3"],
      image: "/flowryd/car-tesla-3-2.jpg",
      price: "$41,200",
      condition: "New",
      location: "Berkeley, CA",
      exterior: 'Pearl white, 18" aero wheels'
    },
    {
      ...demoCars["tesla-model-3"],
      image: "/flowryd/car-tesla-3-3.jpg",
      price: "$36,900",
      mileage: "22,400 mi",
      location: "Fremont, CA",
      exterior: 'Ultra red, 19" wheels'
    },
    {
      ...demoCars["tesla-model-3"],
      image: "/flowryd/car-tesla-3-4.jpg",
      price: "$39,500",
      mileage: "11,800 mi",
      location: "Daly City, CA",
      exterior: 'Gray metallic, 18" wheels'
    }
  ],
  "rivian-r1s": [
    demoCars["rivian-r1s"],
    {
      ...demoCars["rivian-r1s"],
      image: "/flowryd/car-rivian-2.jpg",
      price: "$72,800",
      condition: "Used",
      mileage: "9,300 mi",
      location: "Santa Monica, CA",
      exterior: 'Forest Edge green, 20" wheels'
    }
  ]
};

export const demoQuickStats: Record<string, { cargo: string; efficiency: string; battery: string; soh: string }> = {
  "tesla-model-y": { cargo: "854 L", efficiency: "16.9 kWh/100 km", battery: "81 kWh", soh: "94%" },
  "cadillac-lyriq": { cargo: "793 L", efficiency: "22.4 kWh/100 km", battery: "102 kWh", soh: "96%" },
  "tesla-model-3": { cargo: "682 L", efficiency: "13.5 kWh/100 km", battery: "75 kWh", soh: "92%" },
  "rivian-r1s": { cargo: "1,084 L", efficiency: "24.1 kWh/100 km", battery: "135 kWh", soh: "97%" }
};

export const demoScoreBreakdown: Record<string, Array<[string, number]>> = {
  "tesla-model-y": [["Price", 100], ["Range", 100], ["Efficiency", 100], ["TCO", 78], ["Cargo / seats", 100], ["Features", 100], ["Semantic", 74]],
  "cadillac-lyriq": [["Price", 72], ["Range", 92], ["Efficiency", 85], ["TCO", 70], ["Cargo / seats", 95], ["Features", 100], ["Semantic", 80]],
  "tesla-model-3": [["Price", 100], ["Range", 96], ["Efficiency", 100], ["TCO", 95], ["Cargo / seats", 80], ["Features", 95], ["Semantic", 82]],
  "rivian-r1s": [["Price", 60], ["Range", 100], ["Efficiency", 78], ["TCO", 62], ["Cargo / seats", 100], ["Features", 100], ["Semantic", 70]]
};

export function demoPriceRange(listings: DemoCar[]) {
  const nums = listings.map((listing) => Number(listing.price.replace(/[^0-9.]/g, "")));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const format = (value: number) => `$${value.toLocaleString()}`;
  return min === max ? format(min) : `${format(min)} - ${format(max)}`;
}
