"""
VWDM palette loader — Sync to Drawing

Paste this ONCE into a Script Palette script (name it e.g. "2. Sync to Drawing").
It runs the CURRENT sync_app_to_drawing.py straight from the Dropbox folder, so
edits to that file take effect with no re-pasting into Vectorworks.

Only touch this loader if the project folder ever moves (update the paths).
"""

import os

# Same cross-machine idea as DB_PATH_CANDIDATES: first path that exists wins.
TARGET_CANDIDATES = [
    r"C:\Users\Gabe\Dropbox\Claude\Database Vectorworks\vw-device-manager\vectorworks-scripts\sync_app_to_drawing.py",
    "/Users/gabe/Library/CloudStorage/Dropbox/Claude/Database Vectorworks/vw-device-manager/vectorworks-scripts/sync_app_to_drawing.py",
]


def _run():
    for path in TARGET_CANDIDATES:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                source = f.read()
            exec(compile(source, path, "exec"), {"__name__": "__main__", "__file__": path})
            return
    import vs

    vs.AlrtDialog(
        "Loader could not find sync_app_to_drawing.py. Tried:\n\n" + "\n".join(TARGET_CANDIDATES)
    )


_run()
