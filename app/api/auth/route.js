import handler from "../../../api/auth.mjs";
import { runLegacyHandler } from "../_legacy-adapter.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function handle(request) {
  return runLegacyHandler(handler, request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const PUT = handle;
export const PATCH = handle;
export const OPTIONS = handle;
export const HEAD = handle;
