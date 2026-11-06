import { requireUser } from "../_shared/auth.ts";
import { markCorVerified } from "../_shared/attestor.ts";
import { json, withCors } from "../_shared/cors.ts";
import { errorResponse, HttpError, requireEnv } from "../_shared/errors.ts";
import { isAdmin } from "../_shared/firestore.ts";
import { corBucket } from "../_shared/storage.ts";
import { COR_MAX_BYTES, corObjectPath, detectCorType, isValidUid } from "../_shared/validate.ts";

// POST { studentUid } -> { ok: true }   (admin only)
// Confirms the student's COR really exists at the expected private path and is a valid PDF/JPG/PNG within
// the size limit, then records users/{studentUid}.corVerifiedAt using the low-privilege attestor account.
// Firestore rules refuse an approval unless corVerifiedAt is set, and no client can set that field.

Deno.serve((req) =>
  withCors(req, ["POST"], async (cors) => {
    try {
      const projectId = requireEnv("FIREBASE_PROJECT_ID");
      const { uid, token } = await requireUser(req, projectId);
      if (!(await isAdmin(projectId, uid, token))) throw new HttpError(403, "Only the administrator can do that.");

      const body = await req.json().catch(() => null) as { studentUid?: unknown } | null;
      const studentUid = body?.studentUid;
      if (!isValidUid(studentUid)) throw new HttpError(400, "Invalid request.");

      const { data, error } = await corBucket().download(corObjectPath(studentUid));
      if (error || !data) throw new HttpError(404, "No COR was found for that student, so it can't be approved.");
      if (data.size === 0 || data.size > COR_MAX_BYTES) throw new HttpError(422, "The stored COR file is not valid.");
      if (!detectCorType(new Uint8Array(await data.slice(0, 16).arrayBuffer()))) {
        throw new HttpError(422, "The stored COR file is not a valid PDF, JPG or PNG.");
      }

      await markCorVerified(projectId, studentUid);
      return json({ ok: true }, 200, cors);
    } catch (error) {
      return errorResponse("verify-cor", error, cors);
    }
  })
);
