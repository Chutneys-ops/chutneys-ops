import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUploadFile, isOwnFilePath, newFileId, uploadExtension } from "./uploads.ts";

const ME = "a0000000-0000-0000-0000-00000000000a";
const OTHER = "b0000000-0000-0000-0000-00000000000b";

test("own-folder paths for certificates and signatures", () => {
  const id = newFileId();
  assert.equal(isOwnFilePath(`${ME}/${id}.pdf`, ME, ["jpg", "pdf"]), true);
  assert.equal(isOwnFilePath(`${OTHER}/${id}.pdf`, ME, ["jpg", "pdf"]), false);
  assert.equal(isOwnFilePath(`${ME}/${id}.png`, ME, ["jpg", "pdf"]), false);
  assert.equal(isOwnFilePath(`${ME}/sub/${id}.pdf`, ME, ["pdf"]), false);
  assert.equal(isOwnFilePath(`${ME}/../${id}.pdf`, ME, ["pdf"]), false);
});

test("upload file checks are shared", () => {
  assert.equal(uploadExtension("image/png"), "png");
  assert.equal(checkUploadFile({ type: "application/pdf", size: 1000 }), null);
  assert.ok(checkUploadFile({ type: "image/gif", size: 1000 }));
});
