import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/admin-api";
import { importVehiclesFromCsv } from "@/lib/repositories/admin-vehicle-repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireAdminApiSession();
  if (auth.response) return auth.response;

  const contentType = request.headers.get("content-type") ?? "";
  let csvContent = "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "CSV file is required." }, { status: 400 });
    }
    csvContent = await file.text();
  } else {
    csvContent = await request.text();
  }

  if (!csvContent.trim()) {
    return NextResponse.json({ error: "CSV content is empty." }, { status: 400 });
  }

  const result = await importVehiclesFromCsv(csvContent);
  return NextResponse.json(result);
}
