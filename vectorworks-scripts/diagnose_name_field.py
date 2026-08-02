"""
VW Device Manager — diagnostic (not part of normal workflow)

Select one real ConnectCAD device and run this. It reports the object's
generic Vectorworks name, the name of its PIO parameter record, and the
value of several likely candidate fields within that record — so we can
find which one actually holds the device's displayed name (e.g. SRV101).
"""

import vs

CANDIDATES = [
    "Device Name",
    "DeviceName",
    "Name",
    "Device Label",
    "Label",
    "Display Tag",
    "DisplayTag",
    "Tag",
    "Number",
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

    for field in CANDIDATES:
        val = vs.GetRField(h, pio_name, field)
        if val is not None:
            lines.append("{0} = {1}".format(field, repr(val)))

    vs.AlrtDialog("\n".join(lines))


main()
