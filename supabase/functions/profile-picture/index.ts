import { requireUser } from "../_shared/auth.ts";
import { AVATAR_CACHE_SECONDS, AVATAR_MAX_BYTES, avatarObjectPath, detectAvatarType } from "../_shared/avatar.ts";
import { json, withCors } from "../_shared/cors.ts";
import { errorResponse, HttpError, requireEnv, UpstreamError } from "../_shared/errors.ts";
import { profileExists } from "../_shared/firestore.ts";
import { avatarBucket } from "../_shared/storage.ts";
import { isValidUid } from "../_shared/validate.ts";

// POST   multipart/form-data { file }  -> stores the caller's profile picture at profile-pictures/{their uid}/avatar
// DELETE                               -> removes it (removing a picture that does not exist is not an error)
//
// The storage path comes ONLY from the verified token's uid and the file always lands on that one path, so a new
// picture overwrites the old one and nothing is left behind. Nothing in the request (form fields, headers) can choose
// another path or another user. The bucket is public for READING (pictures are shown to other students); every
// write goes through this function using the service-role key, which never leaves the function runtime.
// This function does not touch Firestore: the app records users/{uid}.photoPath itself, and the Firestore rules only
// let a student set that field to their own path.

Deno.serve((req) =>
  withCors(req, ["POST", "DELETE"], async (cors) => {
    try {
      const projectId = requireEnv("FIREBASE_PROJECT_ID");
      const { uid, token } = await requireUser(req, projectId);
      if (!isValidUid(uid)) throw new HttpError(400, "This account type is not supported.");
      // Only students who finished signing up (they have a profile) can have a picture.
      if (!(await profileExists(projectId, uid, token))) throw new HttpError(409, "Please finish creating your account first.");
      const path = avatarObjectPath(uid);

      if (req.method === "DELETE") {
        const { error } = await avatarBucket().remove([path]);
        if (error) throw new UpstreamError("Storage remove failed");
        return json({ ok: true }, 200, cors);
      }

      // Refuse oversized bodies before reading them into memory.
      const length = Number(req.headers.get("Content-Length"));
      if (!Number.isFinite(length) || length <= 0) throw new HttpError(411, "Could not read the file size.");
      if (length > AVATAR_MAX_BYTES + 64 * 1024) throw new HttpError(413, "That picture is too large. Please choose one under 2 MB.");

      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) throw new HttpError(400, "Please choose a picture.");
      if (file.size === 0) throw new HttpError(400, "That file is empty. Please choose your picture again.");
      if (file.size > AVATAR_MAX_BYTES) throw new HttpError(413, "That picture is too large. Please choose one under 2 MB.");

      const type = detectAvatarType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
      if (!type) throw new HttpError(415, "Please choose a JPG, PNG or WebP image.");

      const { error } = await avatarBucket().upload(path, file, { contentType: type, upsert: true, cacheControl: AVATAR_CACHE_SECONDS });
      if (error) throw new UpstreamError("Storage upload failed");
      return json({ ok: true, path }, 200, cors);
    } catch (error) {
      return errorResponse("profile-picture", error, cors);
    }
  })
);
