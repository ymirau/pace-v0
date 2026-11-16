import { useMsal } from "@azure/msal-react";
import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useSendSupport, useSupportConfig } from "../api/support";
import { AUTH_BYPASS } from "../authBypass";
import {
  Field,
  FormBanner,
  SelectField,
  TextInput,
  Textarea,
  btnClass,
  btnPrimaryClass,
} from "../components/ModalForm";
import PageHeading from "../components/PageHeading";
import { BUILD_STAMP, ENV_LABEL } from "../env";
import {
  SUPPORT_KINDS,
  type SupportKind,
  diagnosticLines,
  isSendable,
  supportBody,
  supportMailto,
  supportSubject,
} from "../lib/supportMail";
import {
  SUPPORT_PHOTOS_MAX,
  type SupportPhoto,
  newPhotoKey,
  preparePhoto,
  roomFor,
  sendablePhotos,
} from "../lib/supportPhotos";

/**
 * The support form - `/support`.
 *
 * ## A page, not a modal
 *
 * Every nav entry is a route (Layout's NAV renders a `NavLink` in both the
 * sidebar and the rail), so a modal would have meant a second kind of nav item.
 * A page needs none of that and is deep-linkable. Anyone signed in can report.
 *
 * ## The app sends it
 *
 * Send posts to `POST /api/support` (`api/support.ts`), and the backend mails
 * the configured support address with Reply-To set to the sender. "Sent
 * successfully" is shown only once the API says the relay accepted it, so it is
 * a real outcome. With mail turned off in this environment (local dev) the API
 * answers `disabled` and the page says nothing was sent.
 *
 * A failure keeps everything typed and offers the old `mailto:` hand-off as a
 * fallback. That hand-off cannot be observed - a phone with no mail client does
 * nothing visible - so after it the composed message is revealed with the
 * address beside it, and nothing is lost either way.
 *
 * When the environment has no support address (`configured: false`, i.e.
 * `SUPPORT_EMAIL` is blank) there is nowhere to send, by API or by mail app, so
 * Send is disabled and the page says so.
 *
 * ## Photos
 *
 * Up to three, resized on the device as they are chosen (`lib/supportPhotos.ts`).
 * One that cannot be prepared, or is still over the limit, is marked beside its
 * thumbnail and left out; the rest still go. A `mailto:` cannot carry a file,
 * so the fallback copy tells the sender to attach them by hand.
 *
 * ## The diagnostics are the point
 *
 * Environment, build stamp and page are collected automatically and appended to
 * the message: exactly what a support reply would otherwise have to ask for, and
 * what a user cannot answer (nobody memorises a build stamp). The intro says
 * they're included; the sent summary shows them.
 */
export default function SupportPage() {
  const { accounts } = useMsal();
  const account = accounts[0];
  const config = useSupportConfig();
  const send = useSendSupport();

  const [kind, setKind] = useState<SupportKind>("Problem");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<SupportPhoto[]>([]);
  // Set when a pick brought more than there was room for; cleared on the next pick.
  const [photosRefused, setPhotosRefused] = useState(false);
  // Set once the fallback mailto has been followed. Not a success signal -
  // nothing here can observe whether the mail client opened - so the copy is
  // about what to do next, never "sent".
  const [handedOff, setHandedOff] = useState(false);

  const context = {
    userName: AUTH_BYPASS ? "Local dev user" : (account?.name ?? account?.username),
    envLabel: ENV_LABEL,
    buildStamp: BUILD_STAMP,
    // Where they came from, not this page: the referrer is the screen the
    // problem is about. Falls back to this page's own URL when there is none.
    pageUrl: document.referrer || window.location.href,
    userAgent: navigator.userAgent,
  };

  const message = { kind, subject, body };
  const unconfigured = config.data?.configured === false;
  const address = config.data?.configured ? config.data.support_email : "";
  const preparing = photos.some((photo) => photo.preparing);
  const photosFull = photos.length >= SUPPORT_PHOTOS_MAX;
  const canSend = isSendable(message) && !unconfigured && !send.isPending && !preparing;
  // A 422 is the server refusing the input itself, which the sender fixes in
  // place; only other failures offer the mail-app fallback.
  const fallbackOffered = send.isError && !isValidationError(send.error) && address !== "";

  const choosePhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    // Cleared, or choosing the same file again fires no change event.
    event.target.value = "";
    if (chosen.length === 0) return;
    const room = roomFor(photos.length, chosen.length);
    setPhotosRefused(room < chosen.length);
    const added = chosen
      .slice(0, room)
      .map((file) => ({ key: newPhotoKey(), file, preparing: true, error: null }));
    setPhotos((current) => [...current, ...added]);
    for (const photo of added) {
      void preparePhoto(photo.file).then((prepared) =>
        // Functional update: the photo may have been removed while resizing,
        // in which case there is nothing left to update.
        setPhotos((current) =>
          current.map((p) => (p.key === photo.key ? { ...p, ...prepared, preparing: false } : p)),
        ),
      );
    }
  };

  const removePhoto = (key: string) => {
    setPhotosRefused(false);
    setPhotos((current) => current.filter((photo) => photo.key !== key));
  };

  const submit = () => {
    if (!canSend) return;
    setHandedOff(false);
    send.mutate({
      kind,
      subject: subject.trim(),
      details: body.trim(),
      diagnostics: diagnosticLines(context).join("\n"),
      images: sendablePhotos(photos),
    });
  };

  const openMailApp = () => {
    // location.assign rather than window.open: a popup blocker silently
    // swallows the second, and there is no window to leave behind either way.
    window.location.assign(supportMailto(address, message, context));
    setHandedOff(true);
  };

  const startOver = () => {
    send.reset();
    setKind("Problem");
    setSubject("");
    setBody("");
    setPhotos([]);
    setPhotosRefused(false);
    setHandedOff(false);
  };

  // Sent (or, with mail off here, accepted and not sent): the form is done
  // with. Show the outcome and, read-only, what went.
  if (send.isSuccess) {
    const disabled = send.data.status === "disabled";
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeading title="Contact support" />
        <div className="mt-5 rounded-lg border border-slate-200 bg-surface p-4">
          {/* role="status" so a screen reader announces the outcome. */}
          <p role="status" className="text-sm font-medium text-slate-900">
            {disabled
              ? "Mail is turned off in this environment - nothing was sent"
              : "Your message was sent successfully to support"}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {disabled
              ? "The request was accepted and logged, but no email left this environment."
              : "Support will reply to your email address. This is what was sent:"}
          </p>
          <SentMessage
            subject={supportSubject(message, context)}
            body={supportBody(message, context)}
            attached={sendablePhotos(photos).map((photo) => photo.name)}
          />
          <button type="button" className={`${btnClass} mt-4`} onClick={startOver}>
            New request
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeading title="Contact support" />
      <p className="mt-1 text-sm text-slate-600">
        Describe what you need and this sends it to support - including which environment and
        build you are on. Support replies to your email address.
      </p>

      <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
        {/* The form's only key: its own row at the top right, above the fields. */}
        <p className="-mt-2.5 mb-2 text-right text-[11px] text-slate-500">
          <span className="text-red-600">*</span> denotes required field
        </p>
        <SelectField
          label="This is a"
          value={kind}
          onChange={(event) => setKind(event.target.value as SupportKind)}
        >
          {SUPPORT_KINDS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </SelectField>

        <TextInput
          label="Subject"
          required
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Short summary"
        />

        <Textarea
          label="Details"
          required
          rows={7}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What happened, what you expected, and what you were trying to do."
        />

        <Field label="Photos">
          <div className="flex flex-wrap items-center gap-2">
            {/* One picker: on a phone the OS offers the camera alongside the
                library. sr-only, not hidden, so it stays keyboard-reachable;
                the label is the visible control, so a full set dims it by hand. */}
            <label
              htmlFor="support-photo"
              className={`${btnClass} ${photosFull ? "pointer-events-none opacity-50" : ""}`}
            >
              Add photos
            </label>
            <input
              id="support-photo"
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={photosFull}
              onChange={choosePhotos}
            />
            <span className="text-xs text-slate-600">
              {photos.length} of {SUPPORT_PHOTOS_MAX}
            </span>
          </div>
          {photosRefused && (
            <p className="mt-1 text-xs text-red-600">
              Only {SUPPORT_PHOTOS_MAX} photos can be attached; the rest were left out.
            </p>
          )}
          {photos.length > 0 && (
            // Three equal columns, so all three always share one row: the cards
            // shrink with the width rather than wrapping.
            <ul className="mt-2 grid grid-cols-3 gap-2">
              {photos.map((photo) => (
                <PhotoThumb key={photo.key} photo={photo} onRemove={() => removePhoto(photo.key)} />
              ))}
            </ul>
          )}
        </Field>
      </div>

      {/* Below the card, beside the buttons, not at the top of the card: Send
          is at the bottom of a long form, so a banner up there would be off
          screen at the moment it appears. */}
      {/* px-[17px]: the card's 1px border + p-4, so Send lines up with the inputs'
          right edge and the banner with their width. */}
      <div className="mt-4 px-[17px]">
        {send.isError && <FormBanner>{errorMessage(send.error)}</FormBanner>}

        {/* Right-aligned, with the fallback before Send so Send stays at the edge. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {fallbackOffered && (
            <button type="button" className={btnClass} onClick={openMailApp}>
              Open mail app instead
            </button>
          )}
          <button type="button" className={btnPrimaryClass} onClick={submit} disabled={!canSend}>
            {send.isPending ? "Sending…" : "Send"}
          </button>
        </div>
        {fallbackOffered && photos.length > 0 && (
          <p className="mt-2 text-right text-xs text-slate-600">
            A mail app can't carry the photos from here - attach them to the email by hand.
          </p>
        )}
        {unconfigured && (
          <p className="mt-2 text-right text-xs text-slate-600">
            Support isn't configured yet: SUPPORT_EMAIL is blank on this environment.
          </p>
        )}
      </div>

      {handedOff && (
        // Deliberately not "Sent". Nothing here can know whether the mail client
        // opened - on a device with none configured, following the link does
        // nothing visible at all - so this offers the fallback rather than
        // claiming an outcome.
        <div className="mt-4 rounded-lg border border-slate-200 bg-surface p-4">
          <p className="text-sm font-medium text-slate-900">Your mail app should have opened</p>
          <p className="mt-1 text-sm text-slate-600">
            If it did not, send this to{" "}
            <span className="font-medium text-slate-900">{address}</span> yourself - the whole
            message is below.
          </p>
          {photos.length > 0 && (
            <p className="mt-1 text-sm text-slate-600">
              Your photos are not in it: attach them to the email by hand.
            </p>
          )}
          <SentMessage
            subject={supportSubject(message, context)}
            body={supportBody(message, context)}
          />
        </div>
      )}
    </div>
  );
}

/** A 422: the server refused the input itself, which the sender can fix here. */
function isValidationError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 422;
}

/** The server's own words for a refusal, or the network error's. */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return error instanceof Error ? error.message : String(error);
}

// Compact secondary button for a photo's Remove.
const btnSmallClass =
  "inline-flex items-center rounded-md border border-slate-300 bg-surface px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

/**
 * A message's subject, body and attachment names, read-only. Shared by the
 * sent card (what went) and the mail-app fallback (what to send by hand).
 * Selectable text so it can be copied on a phone.
 */
function SentMessage({
  subject,
  body,
  attached = [],
}: {
  subject: string;
  body: string;
  attached?: string[];
}) {
  return (
    <>
      <p className="mt-3 text-xs font-medium text-slate-600">Subject</p>
      <p className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-xs break-words text-slate-900">
        {subject}
      </p>
      <p className="mt-3 text-xs font-medium text-slate-600">Message</p>
      <pre className="mt-1 overflow-x-auto rounded-md bg-slate-50 px-3 py-2 text-xs whitespace-pre-wrap text-slate-900">
        {body}
      </pre>
      {attached.length > 0 && (
        <>
          <p className="mt-3 text-xs font-medium text-slate-600">Attached</p>
          <ul className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-900">
            {attached.map((name) => (
              <li key={name} className="truncate">
                {name}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/**
 * One chosen photo: a thumbnail of what will be sent, its refusal if any, and a
 * way to take it back off.
 *
 * A data URL rather than an object URL: nothing to revoke, so a removed or
 * re-resized photo cannot leak one. Read again when the resize swaps the file;
 * a read that lands after that is ignored.
 */
function PhotoThumb({ photo, onRemove }: { photo: SupportPhoto; onRemove: () => void }) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPreview({ file: photo.file, url: reader.result });
    };
    reader.readAsDataURL(photo.file);
    return () => reader.abort();
  }, [photo.file]);
  const url = preview?.file === photo.file ? preview.url : null;

  return (
    // min-w-0: a grid cell's default min width is its content, which would let
    // a long filename widen the card and push the row past the screen.
    <li className="flex min-w-0 flex-col gap-1 rounded-md border border-slate-200 p-1">
      {url ? (
        <img src={url} alt={photo.file.name} className="h-14 w-full rounded object-cover" />
      ) : (
        <div className="h-14 w-full rounded bg-slate-50" />
      )}
      <p className="truncate text-xs text-slate-900">{photo.file.name}</p>
      {photo.preparing && <p className="text-xs text-slate-600">Preparing…</p>}
      {photo.error && <p className="text-xs text-red-600">{photo.error}</p>}
      <button
        type="button"
        className={`${btnSmallClass} w-full justify-center`}
        onClick={onRemove}
        aria-label={`Remove ${photo.file.name}`}
      >
        Remove
      </button>
    </li>
  );
}
