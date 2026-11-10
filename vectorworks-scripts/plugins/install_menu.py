"""
Puts the Device Manager commands in Vectorworks' menus: Tools > Partner Products
> Device Manager (Vectorworks 2027; called Third-party in earlier versions). Run it ONCE per computer from the Script Palette, after the
plug-ins are installed (see ../README.md). Run it again to put them back if a
workspace change loses them.

To remove them: run it with UNINSTALL = True.
"""

import vs

UNINSTALL = False
COMPANY = "Device Manager"
# Must match the plug-in names build_vsm.py writes.
COMMANDS = ["Device Manager - Link Selected", "Device Manager - Sync to Drawing"]

if UNINSTALL:
    vs.wsDelete(COMPANY, False, True)
    vs.AlrtDialog("Device Manager commands removed from the menus.")
else:
    vs.wsDelete(COMPANY, False, False)  # no duplicates when run twice
    vs.wsEditBegin(COMPANY)
    for name in COMMANDS:
        vs.wsEditAddMenu(name)
    if vs.wsEditEnd(False):
        vs.AlrtDialog("Added to Tools > Partner Products (or Third-party) > Device Manager.\n\nIf they don't show yet, restart Vectorworks.")
    else:
        vs.AlrtDialog(
            "Vectorworks couldn't add the commands. Check that the two "
            "'Device Manager - …' plug-ins are listed in Tools > Plug-ins > Plug-in Manager."
        )
