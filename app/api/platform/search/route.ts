import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/src/lib/auth";
import { isPlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import { searchPlatform } from "@/app/src/lib/platform";

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.email || !isPlatformAdmin(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q") || "";

  if (query.length < 2) {
    return NextResponse.json({ results: [], query, totalCount: 0 });
  }

  try {
    const results = await searchPlatform(query);
    return NextResponse.json(results);
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
