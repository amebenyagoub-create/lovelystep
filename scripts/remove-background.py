"""Batch background removal worker used by the Node.js upload pipeline."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from rembg import new_session, remove


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--model", default="isnet-general-use")
    args = parser.parse_args()

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    session = new_session(args.model)
    alpha_matting = os.environ.get("BACKGROUND_REMOVAL_ALPHA_MATTING", "false").lower() in {"1", "true", "yes"}

    for job in manifest["jobs"]:
        source = Path(job["input"])
        destination = Path(job["output"])
        result = remove(
            source.read_bytes(),
            session=session,
            alpha_matting=alpha_matting,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=10,
            alpha_matting_erode_size=8,
            post_process_mask=True,
            force_return_bytes=True,
        )
        destination.write_bytes(result)


if __name__ == "__main__":
    main()
