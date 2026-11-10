"""
Builds the Device Manager menu-command plug-ins (.vsm) for Vectorworks.

Run on a dev machine (plain Python 3, not inside Vectorworks):
    python3 build_vsm.py

Each .vsm holds a tiny loader that runs the current script from the Dropbox
folder, so the plug-ins never need rebuilding when a script changes — only when
a command is added or renamed.

The .vsm layout was worked out from Plug-in Manager output (2026): a fixed
header with the command name twice, its category, the Python source at an
offset/length, and a tail of default icons whose offsets follow the source.
`template.vsm` is such a file with an empty script. The self-check below
rebuilds a file and reads it back; with --roundtrip <a.vsm> <b.vsm> it rebuilds
b from a's layout and checks the bytes match exactly.
"""

import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "template.vsm")
OUT_DIR = os.path.join(HERE, "..", "workgroup", "Plug-ins")
CATEGORY = "Device Manager"

NAME_A, NAME_B, CAT = 0x06, 0xA2, 0x46  # Pascal strings, 63 bytes max
SCRIPT_AT, SCRIPT_LEN = 0x88, 0x8C
# Header fields that point past the script (its end, then the icon blocks).
TAIL_OFFSETS = (0x94, 0x98, 0xE2, 0xEA, 0xF8, 0x100, 0x108, 0x110, 0x118, 0x11C)

# Menu name -> script in vectorworks-scripts/
COMMANDS = {
    "Device Manager - Link Selected": "link_selected.py",
    "Device Manager - Sync to Drawing": "sync_app_to_drawing.py",
}


def pascal(buf, at, text):
    raw = text.encode("mac_roman")
    if len(raw) > 63:
        raise ValueError(f"name too long for a .vsm (63 max): {text}")
    buf[at : at + 64] = bytes([len(raw)]) + raw + bytes(63 - len(raw))


def read_pascal(buf, at):
    return bytes(buf[at + 1 : at + 1 + buf[at]]).decode("mac_roman")


def script_of(buf):
    at, n = struct.unpack_from("<II", buf, SCRIPT_AT)
    return bytes(buf[at : at + n])


def build(template, name, category, script):
    """A .vsm from `template` with this name, category and Python source."""
    t = bytearray(template)
    at, old_len = struct.unpack_from("<II", t, SCRIPT_AT)
    delta = len(script) - old_len
    out = t[:at] + script + t[at + old_len :]
    struct.pack_into("<I", out, SCRIPT_LEN, len(script))
    for p in TAIL_OFFSETS:
        struct.pack_into("<I", out, p, struct.unpack_from("<I", t, p)[0] + delta)
    pascal(out, NAME_A, name)
    pascal(out, NAME_B, name)
    pascal(out, CAT, category)
    assert struct.unpack_from("<I", out, 0x11C)[0] == len(out), "last offset must be the file size"
    return bytes(out)


LOADER = '''# {name}
# Built by vw-device-manager/vectorworks-scripts/plugins/build_vsm.py.
# Runs the CURRENT {target} from the Dropbox folder, so script edits need no reinstall.
import os
import vs

CANDIDATES = [
    os.path.expanduser(r"~\\Dropbox\\Claude\\Database Vectorworks\\vw-device-manager\\vectorworks-scripts\\{target}"),
    os.path.expanduser("~/Library/CloudStorage/Dropbox/Claude/Database Vectorworks/vw-device-manager/vectorworks-scripts/{target}"),
    os.path.expanduser("~/Dropbox/Claude/Database Vectorworks/vw-device-manager/vectorworks-scripts/{target}"),
]

for path in CANDIDATES:
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            exec(compile(f.read(), path, "exec"), {{"__name__": "__main__", "__file__": path}})
        break
else:
    vs.AlrtDialog("Device Manager could not find {target}. Looked in:\\n\\n" + "\\n".join(CANDIDATES))
'''


def main():
    if sys.argv[1:2] == ["--roundtrip"]:
        a, b = (open(p, "rb").read() for p in sys.argv[2:4])
        again = build(a, read_pascal(b, NAME_A), read_pascal(b, CAT), script_of(b))
        print("identical" if again == b else "DIFFERENT")
        return 0 if again == b else 1

    template = open(TEMPLATE, "rb").read()
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, target in COMMANDS.items():
        source = LOADER.format(name=name, target=target).encode("utf-8")
        data = build(template, name, CATEGORY, source)
        assert read_pascal(data, NAME_A) == name and script_of(data) == source
        compile(source, name, "exec")  # the loader itself must be valid Python
        with open(os.path.join(OUT_DIR, name + ".vsm"), "wb") as f:
            f.write(data)
        print("wrote", name + ".vsm")
    return 0


if __name__ == "__main__":
    sys.exit(main())
