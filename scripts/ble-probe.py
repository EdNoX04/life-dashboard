#!/usr/bin/env python3
"""
Can we read the Noise band directly over Bluetooth?

Ten-minute question, asked before committing to anything. Everything else about
getting this band's data is either dead or nearly empty:

  · Google Fit  — new developer signups closed May 2024, APIs shut down end of
                  2026. Cannot be signed up for, let alone built on.
  · Apple Health — NoiseFit reportedly writes STEPS and nothing else, whatever
                  permissions you grant it.
  · Battery %   — not a health metric anywhere. It is a Bluetooth
                  characteristic, so BLE is the only route that could ever
                  carry it.

So this script answers one thing: does the band expose anything readable to a
device that is not the phone?

WHAT IT DOES NOT DO
It only READS. It does not pair, bond, write, or change a setting on the band.
Worst case it finds nothing.

TWO THINGS MAY BLOCK IT, and both are normal:
  1. The band may bond exclusively to your phone and refuse a second connection.
     Turning Bluetooth off on the phone (or walking away from it) for the length
     of this test is the usual workaround.
  2. Noise may use a proprietary characteristic instead of the standard Battery
     Service. Then the battery is there but unreadable without reverse
     engineering their protocol, which is a different and much larger project.

RUN IT
    pip3 install bleak
    python3 scripts/ble-probe.py            # scan only, names every device
    python3 scripts/ble-probe.py --connect "Noise"   # connect to a match and dump

Keep the band on your wrist and awake while it runs.
"""

import argparse
import asyncio
import sys

try:
    from bleak import BleakScanner, BleakClient
except ImportError:
    sys.exit("bleak is not installed. Run:  pip3 install bleak")

# The standardised GATT assignments worth trying. A band that implements these
# is readable by anything; one that does not has hidden its data behind a
# private protocol.
KNOWN = {
    "00002a19-0000-1000-8000-00805f9b34fb": "Battery level (%)",
    "00002a37-0000-1000-8000-00805f9b34fb": "Heart rate measurement",
    "00002a24-0000-1000-8000-00805f9b34fb": "Model number",
    "00002a25-0000-1000-8000-00805f9b34fb": "Serial number",
    "00002a26-0000-1000-8000-00805f9b34fb": "Firmware revision",
    "00002a29-0000-1000-8000-00805f9b34fb": "Manufacturer",
    "00002a27-0000-1000-8000-00805f9b34fb": "Hardware revision",
}


def mac_bytes(mac: str):
    """The MAC as raw bytes, both ways round.

    macOS never shows you a Bluetooth MAC — CoreBluetooth replaces it with an
    opaque per-host UUID, which is why a scan here lists a dozen "(unnamed)"
    devices and none of them says Noise. But plenty of bands put their MAC
    inside the advertisement payload, and that payload IS visible. Byte order
    varies by vendor, so both are checked.
    """
    raw = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    return raw, raw[::-1]


def adv_blob(adv) -> bytes:
    """Every byte a device is broadcasting, flattened, for searching."""
    out = bytearray()
    for v in (adv.manufacturer_data or {}).values():
        out += v
    for v in (adv.service_data or {}).values():
        out += v
    return bytes(out)


async def find_by_mac(mac: str, seconds: float):
    fwd, rev = mac_bytes(mac)
    print(f"Scanning {seconds:.0f}s for a device broadcasting {mac}…\n")
    hits = []
    found = await BleakScanner.discover(timeout=seconds, return_adv=True)
    for addr, (dev, adv) in found.items():
        blob = adv_blob(adv)
        if fwd in blob or rev in blob:
            hits.append((dev, adv))
            print(f"MATCH  {dev.name or '(unnamed)'}  {addr}  rssi {adv.rssi}")
    if not hits:
        print("No device is broadcasting that MAC.")
        print()
        print("Almost certainly because the band is CONNECTED TO YOUR IPHONE. A")
        print("band that is already in a connection usually stops advertising, or")
        print("advertises as non-connectable, so nothing else can see or reach it.")
        print()
        print("Turn Bluetooth off on the iPhone, wait ten seconds, and run this")
        print("again. If it appears then, the band is reachable — but only while")
        print("the phone is not holding it, which is the finding that matters.")
    return hits


async def scan(seconds: float):
    print(f"Scanning {seconds:.0f}s — keep the band awake…\n")
    found = await BleakScanner.discover(timeout=seconds, return_adv=True)
    if not found:
        print("Nothing advertising. If the phone is connected to the band, it may")
        print("be holding it exclusively — turn the phone's Bluetooth off and retry.")
        return []

    rows = []
    for addr, (dev, adv) in found.items():
        name = dev.name or adv.local_name or "(unnamed)"
        rows.append((adv.rssi if adv.rssi is not None else -999, name, addr, adv))
    rows.sort(reverse=True)   # strongest signal first: the band is on your wrist

    print(f"{'RSSI':>5}  {'NAME':<28} ADDRESS")
    for rssi, name, addr, adv in rows:
        svc = ",".join(s[4:8] for s in (adv.service_uuids or [])[:4])
        # The manufacturer payload is where a MAC usually hides, so show a
        # little of it — it is often the only thing distinguishing one
        # "(unnamed)" from another.
        mfg = ""
        for cid, val in (adv.manufacturer_data or {}).items():
            mfg = f"   mfg {cid:04x}:{val.hex()[:20]}"
            break
        print(f"{rssi:>5}  {name:<28} {addr}{('   svc ' + svc) if svc else ''}{mfg}")
    print("\nThe band is most likely the strongest unnamed-or-Noise-ish entry above.")
    return rows


async def dump(match: str, seconds: float):
    print(f"Looking for a device matching {match!r}…")
    dev = await BleakScanner.find_device_by_filter(
        lambda d, adv: match.lower() in ((d.name or adv.local_name or "") + d.address).lower(),
        timeout=seconds,
    )
    if not dev:
        sys.exit(f"No device matched {match!r}. Run without --connect to see what is nearby.")

    print(f"Found {dev.name or '(unnamed)'} at {dev.address} — connecting…\n")
    async with BleakClient(dev) as client:
        # Every service and characteristic, so even a proprietary layout is
        # visible. A band hiding battery behind a custom UUID still shows the
        # UUID here, which is the first step of any later work.
        readable = []
        for service in client.services:
            print(f"service {service.uuid}  {service.description}")
            for ch in service.characteristics:
                props = ",".join(ch.properties)
                label = KNOWN.get(ch.uuid.lower(), "")
                print(f"   {ch.uuid}  [{props}]{('  <- ' + label) if label else ''}")
                if "read" in ch.properties:
                    readable.append(ch)

        print("\n--- reading everything readable ---")
        for ch in readable:
            try:
                raw = await client.read_gatt_char(ch)
            except Exception as e:                      # noqa: BLE001
                print(f"{ch.uuid}: unreadable ({e})")
                continue
            label = KNOWN.get(ch.uuid.lower(), "")
            # Battery level is a single byte 0-100 by specification.
            if ch.uuid.lower().startswith("00002a19") and len(raw) == 1:
                print(f"{ch.uuid}: BATTERY {raw[0]}%   <-- this is the one that matters")
                continue
            try:
                text = raw.decode("utf-8").strip("\x00").strip()
            except UnicodeDecodeError:
                text = ""
            shown = text if text.isprintable() and text else raw.hex()
            print(f"{ch.uuid}: {shown}{('   (' + label + ')') if label else ''}")

    print("\nDone. Nothing was written to the band.")


async def main():
    ap = argparse.ArgumentParser(description="Probe a BLE fitness band, read-only.")
    ap.add_argument("--connect", metavar="NAME", help="connect to the first device whose name or address contains NAME")
    ap.add_argument("--mac", metavar="AA:BB:CC:DD:EE:FF", help="hunt for a device broadcasting this MAC in its advertisement (macOS hides real MACs, so this searches the payload)")
    ap.add_argument("--seconds", type=float, default=12.0, help="scan duration (default 12)")
    args = ap.parse_args()

    if args.mac:
        hits = await find_by_mac(args.mac, args.seconds)
        if hits:
            dev = hits[0][0]
            print(f"\nConnecting to {dev.address}…\n")
            await dump(dev.address, args.seconds)
    elif args.connect:
        await dump(args.connect, args.seconds)
    else:
        await scan(args.seconds)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
