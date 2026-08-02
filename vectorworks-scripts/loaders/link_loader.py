"""
VWDM palette loader — Link Selected

Paste this ONCE into a Script Palette script (name it e.g. "1. Link Selected").
It runs the CURRENT link_selected.py straight from the Dropbox folder, so after
you edit that file you never have to re-paste anything into Vectorworks again.

Only touch this loader if the project folder ever moves (update the paths).
"""

import os

# Same cross-machine idea as DB_PATH_CANDIDATES: first path that exists wins.
TARGET_CANDIDATES = [
    r"C:\Users\Gabe\Dropbox\Claude\Database Vectorworks\vw-device-manager\vectorworks-scripts\link_selected.py",
    "/Users/gabe/Library/CloudStorage/Dropbox/Claude/Database Vectorworks/vw-device-manager/vectorworks-scripts/link_selected.py",
]


def _run():
    for path in TARGET_CANDIDATES:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                source = f.read()
            # Run it as if it were the top-level script (its trailing main() fires).
            exec(compile(source, path, "exec"), {"__name__": "__main__", "__file__": path})
            return
    import vs

    vs.AlrtDialog(
        "Loader could not find link_selected.py. Tried:\n\n" + "\n".join(TARGET_CANDIDATES)
    )


_run()
