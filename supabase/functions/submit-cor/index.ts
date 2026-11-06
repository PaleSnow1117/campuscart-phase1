import { requireUser } from "../_shared/auth.ts";
import { json, withCors } from "../_shared/cors.ts";
import { errorResponse, HttpError, requireEnv, UpstreamError } from "../_shared/errors.ts";
import { profileExists } from "../_shared/firestore.ts";
import { corBucket } from "../_shared/storage.ts";
import { COR_MAX_BYTES, corObjectPath, detectCorType, isValidUid } from "../_shared/validate.ts";

// POST   multipart/form-data { file }  -> stores the caller's COR at student-cors/{their uid}/cor
// DELETE                              -> removes that file (rollback of an unfinished signup)
//
// The storage path comes ONLY from the verified token's uid. Both methods are refused once the caller has
// a profile document, so a submitted COR can never be replaced or deleted through this function.

Deno.serve((req) =>
  withCors(req, ["POST", "DELETE"], async (cors) => {
    try {
      const projectId = requireEnv("FIREBASE_PROJECT_ID");
      const { uid, token } = await requireUser(req, projectId);
      if (!isValidUid(uid)) throw new HttpError(400, "This account type is not supported.");
      if (await profileExists(projectId, uid, token)) {
        throw new HttpError(409, "Your registration was already submitted.");
      }
      const path = corObjectPath(uid);

      if (req.method === "DELETE") {
        const { error } = await corBucket().remove([path]);
        if (error) throw new UpstreamError("Storage remove failed");
        return json({ ok: true }, 200, cors);
      }

      // Refuse oversized bodies before reading them into memory.
      const length = Number(req.headers.get("Content-Length"));
      if (!Number.isFinite(length) || length <= 0) throw new HttpError(411, "Could not read the file size.");
      if (length > COR_MAX_BYTES + 64 * 1024) throw new HttpError(413, "That file is too large. Please upload a COR under 10 MB.");

      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) throw new HttpError(400, "Please attach your Certificate of Registration (COR).");
      if (file.size === 0) throw new HttpError(400, "That file is empty. Please choose your COR again.");
      if (file.size > COR_MAX_BYTES) throw new HttpError(413, "That file is too large. Please upload a COR under 10 MB.");

      const type = detectCorType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
      if (!type) throw new HttpError(415, "Please upload your COR as a PDF, JPG or PNG file.");

      const { error } = await corBucket().upload(path, file, { contentType: type, upsert: true });
      if (error) throw new UpstreamError("Storage upload failed");
      return json({ ok: true, path }, 200, cors);
    } catch (error) {
      return errorResponse("submit-cor", error, cors);
    }
  })
);
