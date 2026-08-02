"""
VW Device Manager — diagnostic: can we persist a record on a socket?

Select the device (the same one you synced) and run this. For each network
jack it:
  1. Reports the socket's CURRENT VWDM Port fields (what the last sync left,
     if anything).
  2. Attaches VWDM Port (if needed), writes a probe value, and reads it back
     immediately — to tell whether SetRField on a socket "sticks" at all
     within a single run.

Read the result:
  - If `readback` shows 'PROBE-<name>' -> writing to the socket works within a
    run; any earlier blank is a persistence-across-regeneration problem, and
    per-jack data needs to live somewhere the ConnectCAD device won't wipe.
  - If `readback` is None/'' -> the record can't be attached/written to the
    socket at all (sub-object of the device plug-in) -> same conclusion, we
    need a different storage location.
  - If `current` already shows your real IPs -> the sync DID work and the
    Object Info just needs a reselect/refresh.

This writes probe values (harmless test strings) onto the sockets.
"""

import vs

PORT_RECORD = "VWDM Port"
FIELDS = ["vwdm_ip", "vwdm_untagged", "vwdm_tagged"]
SOCKET_RECORD = "Socket"
NETWORK_SIGNALS = {"LAN"}


def network_jacks(h):
    net = {s.upper() for s in NETWORK_SIGNALS}
    jacks = []
    child = vs.FInGroup(h)
    while child:
        rec = vs.GetParametricRecord(child)
        if rec and vs.GetName(rec) == SOCKET_RECORD:
            signal = vs.GetRField(child, SOCKET_RECORD, "signal") or ""
            if signal.strip().upper() in net:
                name = vs.GetRField(child, SOCKET_RECORD, "name") or ""
                jacks.append((name.strip(), child))
        child = vs.NextObj(child)
    return jacks


def main():
    handles = []
    vs.ForEachObject(lambda h: handles.append(h), "(SEL=TRUE)")
    if not handles:
        vs.AlrtDialog("Select the device and run again.")
        return

    jacks = network_jacks(handles[0])
    if not jacks:
        vs.AlrtDialog("No network sockets found on the selection.")
        return

    lines = []
    for name, sock in jacks:
        current = vs.GetRField(sock, PORT_RECORD, FIELDS[0])
        attached_before = current is not None
        if current is None:
            vs.SetRecord(sock, PORT_RECORD)
        probe = "PROBE-" + name
        vs.SetRField(sock, PORT_RECORD, FIELDS[0], probe)
        readback = vs.GetRField(sock, PORT_RECORD, FIELDS[0])
        lines.append(
            "{0}: current={1}  attached_before={2}  readback={3}".format(
                name, repr(current), attached_before, repr(readback)
            )
        )

    vs.AlrtDialog("\n".join(lines))


main()
