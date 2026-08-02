"""
VW Device Manager — diagnostic: dump a device's parametric fields

Not part of the normal workflow. Select ONE real ConnectCAD device and run
this to discover the exact internal field names behind the Object Info
labels — needed because link_selected.py / sync_app_to_drawing.py read fields
by their internal name (e.g. the "Model" shown under Manufacturer, and the
Room / Rack / Rack U / Slot shown under Location), which can differ from the
displayed label in spacing or casing.

It reports, for the selected object:
  1. The generic Vectorworks name and the PIO/record name.
  2. Every parametric field name and its current value (authoritative).
  3. A focused probe of the candidates we care about, so the ones that come
     back non-empty tell us exactly what to put in the script constants.
"""

import vs

# Object Info fields we intend to read into the app. If the full dump in
# section 2 shows a different spelling, use that instead.
CANDIDATES = [
    # Manufacturer section -> device_type
    "Model",
    "Manufacturer",
    # Location section -> combined location
    "Room",
    "Rack",
    "Rack U",
    "RackU",
    "Rack_U",
    "Slot",
]


def main():
    handles = []
    vs.ForEachObject(lambda h: handles.append(h), "(SEL=TRUE)")
    if not handles:
        vs.AlrtDialog("Nothing selected. Select one device and run again.")
        return

    h = handles[0]
    lines = []
    lines.append("vs.GetName(h) = " + repr(vs.GetName(h)))

    rec = vs.GetParametricRecord(h)
    if not rec:
        lines.append("No parametric record on this object.")
        vs.AlrtDialog("\n".join(lines))
        return

    pio_name = vs.GetName(rec)
    lines.append("PIO/record name = " + repr(pio_name))
    lines.append("")

    # --- 1. Full field dump (authoritative) ------------------------------
    lines.append("--- all parametric fields ---")
    try:
        num = vs.NumFields(rec)
        for i in range(1, num + 1):
            fname = vs.GetFldName(rec, i)
            val = vs.GetRField(h, pio_name, fname)
            lines.append("{0}: {1} = {2}".format(i, fname, repr(val)))
    except Exception as e:
        lines.append("(could not enumerate fields: {0})".format(e))

    # --- 2. Focused probe of the candidates we care about ----------------
    lines.append("")
    lines.append("--- candidate probe (non-empty = usable) ---")
    for field in CANDIDATES:
        val = vs.GetRField(h, pio_name, field)
        if val is not None and val != "":
            lines.append("{0} = {1}".format(field, repr(val)))

    vs.AlrtDialog("\n".join(lines))


main()
