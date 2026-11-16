"""Upload policy for the support form's photos: what may be attached.

Everything a caller controls about an upload - its size, its declared content
type, its filename - is checked here rather than in the router, so the limits
live in one importable place. Every refusal is a 422, matching the rest of the
support form's validation.

Images only. Nothing is stored: the bytes go straight into the email.
"""

from fastapi import HTTPException, UploadFile, status

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
"""Server-side cap per image, enforced by :func:`read_upload`. The SPA resizes
photos before sending, so a real one is far below this."""

MAX_FILENAME_LENGTH = 255

_CHUNK_BYTES = 1024 * 1024

IMAGE_CONTENT_TYPES = frozenset(
    {
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        # iOS hands over HEIC/HEIF when the camera roll is not transcoding.
        "image/heic",
        "image/heif",
    }
)


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


def normalise_content_type(raw: str | None) -> str:
    """``"IMAGE/JPEG; charset=binary"`` -> ``"image/jpeg"``.

    Browsers append parameters and vary the case, so comparing the raw header
    against the allow-list would reject perfectly good uploads.
    """
    return (raw or "").split(";")[0].strip().lower()


def image_content_type(raw: str | None) -> str:
    """The normalised content type, or 422 if it is not an image type."""
    content_type = normalise_content_type(raw)
    if content_type not in IMAGE_CONTENT_TYPES:
        raise _unprocessable(
            f"{content_type or 'Files with no content type'} cannot be attached. "
            f"Allowed types: {', '.join(sorted(IMAGE_CONTENT_TYPES))}."
        )
    return content_type


def attachment_filename(raw: str | None) -> str:
    """The basename of what the client sent, length-checked.

    Any directory part is dropped, so a Windows path or a ``../`` never reaches
    the attachment name.
    """
    name = (raw or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    if len(name) > MAX_FILENAME_LENGTH:
        raise _unprocessable(f"Filename must be {MAX_FILENAME_LENGTH} characters or fewer.")
    return name or "image"


async def read_upload(file: UploadFile, filename: str) -> bytes:
    """Read the body into memory, refusing anything over :data:`MAX_UPLOAD_BYTES`.

    Read in chunks and stop as soon as the cap is passed, so a huge upload is
    never buffered whole just to be rejected. An empty body is refused too.
    """
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(_CHUNK_BYTES):
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise _unprocessable(
                f"{filename}: larger than the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit."
            )
        chunks.append(chunk)
    if total == 0:
        raise _unprocessable(f"{filename}: the file is empty.")
    return b"".join(chunks)
