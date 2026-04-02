import { NextResponse } from "next/server";
import { Channel } from "@prisma/client";
import { requireAuthSession } from "@/lib/auth";
import { channels } from "@/lib/demo-data";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();

    if (session.user.role === "patient") {
      return NextResponse.json(
        { ok: false, message: "Patients can view but not publish staff communication." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const channel = String(body.channel ?? "") as Channel;
    const message = String(body.body ?? "").trim();

    if (!(channels as readonly string[]).includes(channel)) {
      return NextResponse.json(
        { ok: false, message: "Invalid communication channel." },
        { status: 400 }
      );
    }

    if (!message) {
      return NextResponse.json(
        { ok: false, message: "Message text is required." },
        { status: 400 }
      );
    }

    await prisma.messageRecord.create({
      data: {
        reference: `MSG-${Date.now()}`,
        channel,
        authorName: session.user.name,
        authorRole: session.user.role,
        body: message
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send message.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;

    return NextResponse.json(
      { ok: false, message: status === 401 ? "Sign in to continue." : message },
      { status }
    );
  }
}
