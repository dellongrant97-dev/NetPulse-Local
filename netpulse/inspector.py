import ipaddress
import json
import logging
import platform
import re
import socket
import struct
import subprocess

import psutil


logger = logging.getLogger("netpulse.inspector")

TUNNEL_PATTERN = re.compile(
    r"vpn|tunnel|tailscale|wireguard|zerotier|openvpn|tap\d*|tun\d*|"
    r"wintun|anyconnect|global.?protect|proton",
    re.IGNORECASE,
)


def is_tunnel_interface(name):
    return bool(TUNNEL_PATTERN.search(name or ""))


def parse_linux_ipv4_routes(contents):
    routes = []
    for line in contents.splitlines()[1:]:
        fields = line.split()
        if len(fields) < 8:
            continue

        try:
            destination = socket.inet_ntoa(
                struct.pack("<I", int(fields[1], 16))
            )
            gateway = socket.inet_ntoa(
                struct.pack("<I", int(fields[2], 16))
            )
            mask = socket.inet_ntoa(
                struct.pack("<I", int(fields[7], 16))
            )
            prefix = ipaddress.IPv4Network(
                f"0.0.0.0/{mask}"
            ).prefixlen
            flags = int(fields[3], 16)
            metric = int(fields[6])
        except (ValueError, OSError):
            continue

        routes.append(
            {
                "destination": f"{destination}/{prefix}",
                "gateway": gateway,
                "interface": fields[0],
                "metric": metric,
                "active": bool(flags & 0x1),
            }
        )

    return routes


def parse_linux_ipv6_routes(contents):
    routes = []
    for line in contents.splitlines():
        fields = line.split()
        if len(fields) < 10:
            continue

        try:
            destination_address = ipaddress.IPv6Address(int(fields[0], 16))
            destination_prefix = int(fields[1], 16)
            gateway = str(ipaddress.IPv6Address(int(fields[4], 16)))
            metric = int(fields[5], 16)
            flags = int(fields[8], 16)
            interface = fields[9]
            if destination_prefix > 128:
                continue
        except (ValueError, ipaddress.AddressValueError):
            continue

        routes.append(
            {
                "destination": f"{destination_address}/{destination_prefix}",
                "gateway": gateway,
                "interface": interface,
                "metric": metric,
                "active": bool(flags & 0x1),
            }
        )

    return routes


class SystemInspector:
    def get_interfaces(self):
        addresses = psutil.net_if_addrs()
        stats = psutil.net_if_stats()
        interfaces = []

        for name, entries in addresses.items():
            interface_addresses = []
            for entry in entries:
                if entry.family in (socket.AF_INET, socket.AF_INET6):
                    if entry.address:
                        interface_addresses.append(entry.address.split("%")[0])

            interface_stats = stats.get(name)
            interfaces.append(
                {
                    "name": name,
                    "description": name,
                    "status": (
                        "Up" if interface_stats and interface_stats.isup else "Down"
                    ),
                    "addresses": sorted(set(interface_addresses)),
                    "tunnel": is_tunnel_interface(name),
                }
            )

        return sorted(interfaces, key=lambda item: item["name"].lower())

    def get_traffic_counters(self):
        counters = psutil.net_io_counters(pernic=True) or {}
        stats = psutil.net_if_stats()
        interfaces = []

        for name, counter in sorted(counters.items(), key=lambda item: item[0].lower()):
            interface_stats = stats.get(name)
            interfaces.append(
                {
                    "name": name,
                    "status": "Up" if interface_stats and interface_stats.isup else "Down",
                    "bytesReceived": int(counter.bytes_recv),
                    "bytesSent": int(counter.bytes_sent),
                    "packetsReceived": int(counter.packets_recv),
                    "packetsSent": int(counter.packets_sent),
                    "errorsIn": int(counter.errin),
                    "errorsOut": int(counter.errout),
                }
            )

        return {
            "supported": True,
            "sampledAt": int(__import__("time").time() * 1000),
            "interfaces": interfaces,
        }

    def get_ports(self):
        try:
            connections = psutil.net_connections(kind="inet")
        except (psutil.AccessDenied, OSError):
            logger.warning("Unable to inspect listening network endpoints")
            return []

        ports = []
        for connection in connections:
            if not connection.laddr:
                continue

            is_tcp = connection.type == socket.SOCK_STREAM
            is_udp = connection.type == socket.SOCK_DGRAM

            if is_tcp and connection.status != psutil.CONN_LISTEN:
                continue
            if not is_tcp and not is_udp:
                continue

            ports.append(
                {
                    "protocol": "TCP" if is_tcp else "UDP",
                    "address": connection.laddr.ip,
                    "port": connection.laddr.port,
                    "pid": connection.pid,
                }
            )

        return sorted(
            ports,
            key=lambda item: (
                item["protocol"],
                item["address"],
                item["port"],
                item["pid"] or 0,
            ),
        )

    def get_routes(self):
        system = platform.system()

        if system == "Windows":
            return self._get_windows_routes()
        if system == "Linux":
            return self._get_linux_routes()
        if system == "Darwin":
            return self._get_macos_routes()

        logger.warning("Route collection is unsupported on %s", system)
        return []

    def _get_linux_routes(self):
        routes = []

        try:
            with open("/proc/net/route", encoding="ascii") as route_file:
                routes.extend(parse_linux_ipv4_routes(route_file.read()))
        except OSError:
            logger.warning("Unable to read Linux IPv4 routes")

        try:
            with open("/proc/net/ipv6_route", encoding="ascii") as route_file:
                routes.extend(parse_linux_ipv6_routes(route_file.read()))
        except OSError:
            logger.warning("Unable to read Linux IPv6 routes")

        return routes

    def _get_windows_routes(self):
        script = (
            "Get-NetRoute | Select-Object "
            "@{Name='destination';Expression={$_.DestinationPrefix}}, "
            "@{Name='gateway';Expression={$_.NextHop}}, "
            "@{Name='interface';Expression={$_.InterfaceAlias}}, "
            "@{Name='metric';Expression={$_.RouteMetric}} | "
            "ConvertTo-Json -Compress"
        )

        try:
            result = subprocess.run(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    script,
                ],
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
                **(
                    {"creationflags": subprocess.CREATE_NO_WINDOW}
                    if hasattr(subprocess, "CREATE_NO_WINDOW")
                    else {}
                ),
            )
            data = json.loads(result.stdout or "[]")
            if isinstance(data, dict):
                data = [data]

            routes = []
            for item in data:
                try:
                    routes.append(
                        {
                            "destination": str(item["destination"]),
                            "gateway": str(item["gateway"]),
                            "interface": str(item["interface"]),
                            "metric": int(item["metric"]),
                        }
                    )
                except (KeyError, TypeError, ValueError):
                    continue
            return routes
        except (
            OSError,
            subprocess.SubprocessError,
            json.JSONDecodeError,
        ):
            logger.warning("Unable to collect Windows routes")
            return []

    def _get_macos_routes(self):
        routes = []

        for family in ("inet", "inet6"):
            try:
                result = subprocess.run(
                    ["netstat", "-rn", "-f", family],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    check=True,
                )
            except (OSError, subprocess.SubprocessError):
                logger.warning("Unable to collect macOS %s routes", family)
                continue

            for line in result.stdout.splitlines():
                fields = line.split()
                if len(fields) < 4 or fields[0].lower() in {
                    "destination", "routing", "internet", "internet6"
                }:
                    continue

                destination, gateway, flags = fields[:3]
                interface = fields[-1]
                try:
                    metric = int(fields[3]) if fields[3].isdigit() else 0
                except ValueError:
                    metric = 0

                routes.append(
                    {
                        "destination": destination,
                        "gateway": gateway,
                        "interface": interface,
                        "metric": metric,
                    }
                )

        return routes
