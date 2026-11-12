from netpulse.inspector import (
    parse_linux_ipv4_routes,
    parse_linux_ipv6_routes,
)


def test_linux_ipv4_default_route_is_parsed():
    contents = (
        "Iface Destination Gateway Flags RefCnt Use Metric Mask "
        "MTU Window IRTT\n"
        "eth0 00000000 0101A8C0 0003 0 0 100 00000000 0 0 0\n"
    )

    assert parse_linux_ipv4_routes(contents) == [
        {
            "destination": "0.0.0.0/0",
            "gateway": "192.168.1.1",
            "interface": "eth0",
            "metric": 100,
            "active": True,
        }
    ]


def test_linux_ipv6_default_route_is_parsed():
    contents = (
        "00000000000000000000000000000000 00 "
        "00000000000000000000000000000000 00 "
        "fe800000000000000000000000000001 "
        "00000064 00000000 00000000 00000001 eth0\n"
    )

    assert parse_linux_ipv6_routes(contents) == [
        {
            "destination": "::/0",
            "gateway": "fe80::1",
            "interface": "eth0",
            "metric": 100,
            "active": True,
        }
    ]
