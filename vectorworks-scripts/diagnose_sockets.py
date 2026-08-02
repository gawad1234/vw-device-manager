"""
VW Device Manager — diagnostic: how does a device carry its jacks?

Select ONE ConnectCAD device that has multiple network jacks (e.g. LAN A-D)
and run this. It reports:
  1. The device object itself (type, parametric record, name).
  2. An inventory of the objects contained in the device — for each: index,
     type number, generic name, parametric record name, and its "Name"/label
     field. This tells us how sockets/jacks are represented and how many.
  3. A FULL field dump of the first record-bearing contained object, so we see
     a socket's complete field set — including whichever field holds the
     signal type (to tell RJ45/Ethernet network jacks from AV connectors).

Paste/screenshot the result back so port discovery + per-jack sync can be
written against the real structure (same approach used for the model/loc_*
fields). Read-only — it does not touch the database or the drawing.
"""

import vs

# Compact per-object probe (kept short so the inventory stays readable).
LABEL_CANDIDATES = ["Name", "Label", "Socket Name", "SocketName", "Tag", "Id"]
# Signal/connector type — this is what distinguishes a network jack (RJ45,
# SFP, SFP+, SFP28, QSFP, QSFP+, QSFP28 …) from an AV connector, so surface it
# per socket. We don't yet know the exact field name; probe likely ones and
# the full-field dump below confirms it.
SIGNAL_CANDIDATES = [
    "Signal",
    "Signal Type",
    "SignalType",
    "Connector",
    "Connector Type",
    "ConnectorType",
    "Function",
    "Type",
]


def first_field(h, pio, candidates):
    for f in candidates:
        try:
            v = vs.GetRField(h, pio, f)
        except Exception:
            v = None
        if v is not None and v != "":
            return "{0}={1}".format(f, repr(v))
    return None


def describe(h):
    parts = []
    try:
        parts.append("type=" + str(vs.GetTypeN(h)))
    except Exception:
        pass
    try:
        nm = vs.GetName(h)
        if nm:
            parts.append("name=" + repr(nm))
    except Exception:
        pass
    rec = None
    try:
        rec = vs.GetParametricRecord(h)
    except Exception:
        rec = None
    if rec:
        pio = vs.GetName(rec)
        parts.append("rec=" + repr(pio))
        label = first_field(h, pio, LABEL_CANDIDATES)
        if label:
            parts.append(label)
        signal = first_field(h, pio, SIGNAL_CANDIDATES)
        if signal:
            parts.append("signal:" + signal)
    return "  ".join(parts)


def dump_all_fields(h):
    rec = vs.GetParametricRecord(h)
    if not rec:
        return ["(first child has no parametric record)"]
    pio = vs.GetName(rec)
    out = ["full fields of first record-bearing child (rec={0}):".format(repr(pio))]
    try:
        n = vs.NumFields(rec)
        for i in range(1, n + 1):
            fn = vs.GetFldName(rec, i)
            v = vs.GetRField(h, pio, fn)
            out.append("  {0}: {1} = {2}".format(i, fn, repr(v)))
    except Exception as e:
        out.append("  (enumerate failed: {0})".format(e))
    return out


def main():
    handles = []
    vs.ForEachObject(lambda h: handles.append(h), "(SEL=TRUE)")
    if not handles:
        vs.AlrtDialog("Nothing selected. Select one device and run again.")
        return
    h = handles[0]

    lines = ["DEVICE: " + describe(h), ""]

    # Walk the objects contained in the device.
    lines.append("--- contained objects (FInGroup walk) ---")
    first_record_child = None
    count = 0
    try:
        child = vs.FInGroup(h)
    except Exception as e:
        child = None
        lines.append("FInGroup failed: " + str(e))
    while child:
        count += 1
        lines.append("{0}. {1}".format(count, describe(child)))
        if first_record_child is None:
            try:
                if vs.GetParametricRecord(child):
                    first_record_child = child
            except Exception:
                pass
        if count >= 80:
            lines.append("... (stopped at 80)")
            break
        child = vs.NextObj(child)
    if count == 0:
        lines.append("(no contained objects found via FInGroup)")
    lines.append("Total contained objects: {0}".format(count))

    # Full field dump of the first record-bearing child (likely a socket).
    lines.append("")
    lines.append("--- first record-bearing child, all fields ---")
    if first_record_child is not None:
        lines.extend(dump_all_fields(first_record_child))
    else:
        lines.append("(none found)")

    vs.AlrtDialog("\n".join(lines))


main()
