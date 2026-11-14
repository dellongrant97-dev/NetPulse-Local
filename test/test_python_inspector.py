import socket
from collections import namedtuple

import psutil
import pytest

from netpulse.inspector import SystemInspector, is_tunnel_interface


def test_tunnel_detection_matches_common_vpn_names():
    assert is_tunnel_interface("Tailscale")
    assert is_tunnel_interface("WireGuard")
    assert is_tunnel_interface("OpenVPN")
    assert not is_tunnel_interface("Ethernet")
    assert not is_tunnel_interface("Wi-Fi")


def test_interfaces_include_addresses_status_and_tunnel(monkeypatch):
    Address = namedtuple("Address", "family address netmask broadcast ptp")
    Stats = namedtuple("Stats", "isup")

    monkeypatch.setattr(
        psutil,
        "net_if_addrs",
        lambda: {
            "Wi-Fi": [
                Address(socket.AF_INET, "192.168.1.20", "255.255.255.0", None, None),
                Address(socket.AF_INET6, "fe80::1234", None, None, None),
            ],
            "Tailscale": [
                Address(socket.AF_INET, "100.64.0.2", "255.255.255.255", None, None)
            ],
        },
    )
    monkeypatch.setattr(
        psutil,
        "net_if_stats",
        lambda: {"Wi-Fi": Stats(True), "Tailscale": Stats(False)},
    )

    result = SystemInspector().get_interfaces()
    by_name = {item["name"]: item for item in result}

    assert by_name["Wi-Fi"]["status"] == "Up"
    assert "192.168.1.20" in by_name["Wi-Fi"]["addresses"]
    assert "fe80::1234" in by_name["Wi-Fi"]["addresses"]
    assert by_name["Wi-Fi"]["tunnel"] is False
    assert by_name["Tailscale"]["status"] == "Down"
    assert by_name["Tailscale"]["tunnel"] is True


def test_ports_include_tcp_listeners_and_udp_endpoints(monkeypatch):
    Connection = namedtuple(
        "Connection", "fd family type laddr raddr status pid"
    )
    Address = namedtuple("Address", "ip port")

    monkeypatch.setattr(
        psutil,
        "net_connections",
        lambda kind: [
            Connection(
                1, socket.AF_INET, socket.SOCK_STREAM,
                Address("127.0.0.1", 3000), (), psutil.CONN_LISTEN, 42
            ),
            Connection(
                2, socket.AF_INET, socket.SOCK_DGRAM,
                Address("0.0.0.0", 5353), (), psutil.CONN_NONE, 43
            ),
            Connection(
                3, socket.AF_INET, socket.SOCK_STREAM,
                Address("127.0.0.1", 8080), (), "ESTABLISHED", 44
            ),
        ],
    )

    result = SystemInspector().get_ports()

    assert result == [
        {
            "protocol": "TCP",
            "address": "127.0.0.1",
            "port": 3000,
            "pid": 42,
        },
        {
            "protocol": "UDP",
            "address": "0.0.0.0",
            "port": 5353,
            "pid": 43,
        },
    ]


def test_ports_return_empty_list_when_access_is_denied(monkeypatch):
    def denied(kind):
        raise psutil.AccessDenied()

    monkeypatch.setattr(psutil, "net_connections", denied)

    assert SystemInspector().get_ports() == []


def test_traffic_counters_return_per_interface_byte_totals(monkeypatch):
    Counter = namedtuple(
        "Counter",
        "bytes_sent bytes_recv packets_sent packets_recv errin errout dropin dropout",
    )
    Stats = namedtuple("Stats", "isup")
    monkeypatch.setattr(
        psutil,
        "net_io_counters",
        lambda pernic: {
            "Wi-Fi": Counter(500, 1200, 5, 12, 0, 0, 0, 0),
        },
    )
    monkeypatch.setattr(psutil, "net_if_stats", lambda: {"Wi-Fi": Stats(True)})

    result = SystemInspector().get_traffic_counters()

    assert result["supported"] is True
    assert result["interfaces"] == [{
        "name": "Wi-Fi",
        "status": "Up",
        "bytesReceived": 1200,
        "bytesSent": 500,
        "packetsReceived": 12,
        "packetsSent": 5,
        "errorsIn": 0,
        "errorsOut": 0,
    }]
