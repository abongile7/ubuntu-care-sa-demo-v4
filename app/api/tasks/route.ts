import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();

    if (session.user.role === "patient") {
      return NextResponse.json(
        { ok: false, message: "Only staff roles can create operational tasks." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const title = String(body.title ?? "").trim();
    const owner = String(body.owner ?? "").trim();
    const department = String(body.department ?? "Admissions").trim();
    const priority = String(body.priority ?? "Standard").trim();
    const eta = String(body.eta ?? "").trim();

    if (!title || !owner || !eta) {
      return NextResponse.json(
        { ok: false, message: "Title, owner, and ETA are required." },
        { status: 400 }
      );
    }

    await prisma.shiftTask.create({
      data: {
        reference: `TASK-${Date.now()}`,
        title,
        owner,
        department,
        priority,
        status: "Queued",
        eta
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create task.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;

    return NextResponse.json(
      { ok: false, message: status === 401 ? "Sign in to continue." : message },
      { status }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireAuthSession();

    if (session.user.role === "patient") {
      return NextResponse.json(
        { ok: false, message: "Only staff roles can update operational tasks." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const taskId = String(body.taskId ?? "");
    const statusText = String(body.status ?? "").trim();

    if (!taskId || !statusText) {
      return NextResponse.json(
        { ok: false, message: "Task and status are required." },
        { status: 400 }
      );
    }

    await prisma.shiftTask.update({
      where: { id: taskId },
      data: {
        status: statusText
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update task.";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;

    return NextResponse.json(
      { ok: false, message: status === 401 ? "Sign in to continue." : message },
      { status }
    );
  }
}
