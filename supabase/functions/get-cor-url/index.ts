import { requireUser } from "../_shared/auth.ts";
import { json, withCors } from "../_shared/cors.ts";
import { errorResponse, HttpError, requireEnv } from "../_shared/errors.ts";
import { isAdmin } from "../_shared/firestore.ts";
import { corBucket } from "../_shared/storage.ts";
import { corObjectPath, isValidUid } from "../_shared/validate.ts";

// POST { studentUid } -> { url, expiresIn }   (60-second signed link to that student's COR)
// Allowed only for the owner of the document, or for the admin (a Console-created admins/{uid} record
// that the caller can read with their own token). Every request verifies the Firebase token itself.

const LINK_SECONDS = 60;

Deno.serve((req) =>
  withCors(req, ["POST"], async (cors) => {
    try {
      const projectId = requireEnv("FIREBASE_PROJECT_ID");
      const { uid, token } = await requireUser(req, projectId);

      const body = await req.json().catch(() => null) as { studentUid?: unknown } | null;
      const studentUid = body?.studentUid;
      if (!isValidUid(studentUid)) throw new HttpError(400, "Invalid request.");

      const isOwner = uid === studentUid;
      if (!isOwner && !(await isAdmin(projectId, uid, token))) {
        throw new HttpError(403, "You don't have access to that document.");
      }

      const { data, error } = await corBucket().createSignedUrl(corObjectPath(studentUid), LINK_SECONDS);
      if (error || !data?.signedUrl) throw new HttpError(404, "No COR was found for that student.");
      return json({ url: data.signedUrl, expiresIn: LINK_SECONDS }, 200, cors);
    } catch (error) {
      return errorResponse("get-cor-url", error, cors);
    }
  })
);
